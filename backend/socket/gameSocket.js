const jwt         = require("jsonwebtoken");
const User        = require("../models/User");
const Referral    = require("../models/Referral");
const GameSession = require("../models/GameSession");
const Transaction = require("../models/Transaction");
const fraud       = require("../services/fraud");

const GAME_SECS = Number(process.env.GAME_DURATION_SECONDS) || 300;
const CD_SECS   = Number(process.env.COOLDOWN_DURATION_SECONDS) || 300;
const REFERRAL_REWARD = Number(process.env.REFERRAL_REWARD) || 50;

const ROOMS = {
  1:{name:"Starter Arena",entry:100,maxP:2,prize:160,cut:40},2:{name:"Bronze Arena",entry:200,maxP:2,prize:320,cut:80},
  3:{name:"Silver Arena",entry:500,maxP:2,prize:800,cut:200},4:{name:"Gold Arena",entry:1000,maxP:2,prize:1600,cut:400},
  5:{name:"Platinum Arena",entry:2000,maxP:2,prize:3200,cut:800},6:{name:"Diamond Arena",entry:5000,maxP:2,prize:8000,cut:2000},
  7:{name:"Elite Arena",entry:10000,maxP:2,prize:16000,cut:4000},8:{name:"Quad Bronze",entry:500,maxP:4,prize:1600,cut:400},
  9:{name:"Quad Gold",entry:2000,maxP:4,prize:6400,cut:1600},10:{name:"Quad Elite",entry:5000,maxP:4,prize:16000,cut:4000},
};

const ALLOWED_EMOJIS = ["😂","🔥","💀","👑","🎮","😤","🏆","😎","💪","🍬","😱","❤️","🤣","😈","🙌"];
const gameTimers    = new Map();
const emojiCooldown = new Map();

const authSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user || user.isBanned) return next(new Error("Unauthorized"));
    socket.user = user;
    next();
  } catch (e) { next(new Error("Auth failed")); }
};

const payWinner = async (session, winner) => {
  try {
    const user = await User.findById(winner.userId);
    const before = user.balance;
    user.balance += session.prize; user.totalWon += 1; user.totalGames += 1;
    await user.save();

    await Transaction.create({
      userId: user._id, type:"game_win", amount: session.prize, description:`🏆 Won — ${session.roomName}`,
      status:"completed", gameSessionId: session._id, roomId: session.roomId,
      balanceBefore: before, balanceAfter: user.balance, completedAt: new Date(),
    });

    if (!user.firstGamePlayed) {
      user.firstGamePlayed = true; await user.save();
      const ref = await Referral.findOne({ referredId: user._id, status: { $in:["registered","played"] } });
      if (ref && !ref.referrerPaid) {
        const referrer = await User.findById(ref.referrerId);
        if (referrer && !referrer.isBanned) {
          referrer.balance += REFERRAL_REWARD;
          referrer.referralEarnings += REFERRAL_REWARD;
          await referrer.save();
          await Transaction.create({
            userId: referrer._id, type:"referral_reward", amount: REFERRAL_REWARD,
            description:`🎁 Referral reward — ${user.name} played their first game`,
            status:"completed", reference:`REF_${ref._id}`,
            balanceBefore: referrer.balance-REFERRAL_REWARD, balanceAfter: referrer.balance, completedAt: new Date(),
          });
          ref.status="rewarded"; ref.referrerPaid=true; ref.referrerPaidAt=new Date(); await ref.save();
        }
      }
    }

    await Promise.all(session.players.filter(p=>p.userId.toString()!==winner.userId.toString())
      .map(p => User.findByIdAndUpdate(p.userId, { $inc:{ totalGames:1 } })));

    return true;
  } catch (e) { console.error("payWinner error:", e.message); return false; }
};

const endGame = async (io, session) => {
  try {
    clearTimeout(gameTimers.get(session._id.toString()));
    gameTimers.delete(session._id.toString());

    const valid = session.players.filter(p => !p.flaggedForCheat);
    if (!valid.length) {
      session.status = "cancelled"; await session.save();
      io.to(`s:${session._id}`).emit("game_over", { cancelled:true, reason:"All players flagged" });
      return;
    }

    const winner = valid.reduce((b,p) => p.score>b.score?p:b, valid[0]);
    const rankings = [...session.players].sort((a,b)=>b.score-a.score).map((p,i) => ({
      rank:i+1, name:p.name, score:p.score, userId:p.userId,
      isWinner: p.userId.toString()===winner.userId.toString(), flagged: p.flaggedForCheat,
    }));

    session.status="completed"; session.endTime=new Date();
    session.winnerId=winner.userId; session.winnerName=winner.name; session.winnerScore=winner.score;
    await session.save();

    const paid = await payWinner(session, winner);

    io.to(`s:${session._id}`).emit("game_over", {
      rankings, winner:{ name:winner.name, score:winner.score, userId:winner.userId },
      prize: session.prize, payoutSuccess: paid, won: false, // overridden per-socket below
    });

    // Send a personalized "won" flag to each player
    session.players.forEach(p => {
      io.to(`s:${session._id}`).emit("game_result_personal", {
        userId: p.userId, won: p.userId.toString()===winner.userId.toString(), prize: session.prize,
      });
    });

    console.log(`🎮 GAME OVER | ${session.roomName} | Winner: ${winner.name} ${winner.score}pts`);
  } catch (e) { console.error("endGame error:", e.message); }
};

const initGameSocket = (io) => {
  io.use(authSocket);

  io.on("connection", (socket) => {
    const user = socket.user;
    console.log(`🔌 ${user.name} connected`);

    socket.on("join_room", async ({ roomId, sessionId }) => {
      try {
        const rc = ROOMS[roomId];
        if (!rc) return socket.emit("error", { message:"Invalid room" });

        const dbUser = await User.findById(user._id);
        const cd = dbUser.cooldownRemaining(roomId);
        if (cd>0) return socket.emit("error", { message:`Cooldown: ${Math.ceil(cd/60)} min left`, cooldownRemaining:cd });
        if (dbUser.balance < rc.entry) return socket.emit("error", { message:`Need ₦${rc.entry.toLocaleString()}` });

        let session = sessionId
          ? await GameSession.findById(sessionId)
          : await GameSession.findOne({ roomId, status:"waiting", $expr:{ $lt:[{ $size:"$players" }, rc.maxP] } });

        if (!session) session = await GameSession.create({
          roomId, roomName:rc.name, entryFee:rc.entry, prize:rc.prize, platformCut:rc.cut,
          maxPlayers:rc.maxP, totalPot:rc.entry*rc.maxP, boardSeed:Math.random().toString(36).slice(2),
        });

        if (session.players.some(p => p.userId.toString()===user._id.toString())) {
          socket.join(`s:${session._id}`);
          return socket.emit("room_joined", { sessionId:session._id, players:session.players, alreadyJoined:true });
        }

        if (session.status!=="waiting" || session.players.length>=rc.maxP)
          return socket.emit("error", { message:"Room unavailable" });

        const before = dbUser.balance;
        dbUser.balance -= rc.entry; await dbUser.save();
        await Transaction.create({
          userId:user._id, type:"game_entry", amount:rc.entry, description:`Entry — ${rc.name}`,
          status:"completed", gameSessionId:session._id, roomId,
          balanceBefore:before, balanceAfter:dbUser.balance, completedAt:new Date(),
        });

        session.players.push({ userId:user._id, name:user.name, score:0, hasJoined:true, socketId:socket.id, lastCheckTime:new Date() });
        await session.save();
        socket.join(`s:${session._id}`);
        socket.data.sessionId = session._id.toString();
        socket.data.roomId = roomId;

        io.to(`s:${session._id}`).emit("room_joined", {
          sessionId:session._id, boardSeed:session.boardSeed,
          players: session.players.map(p=>({ name:p.name, userId:p.userId, score:p.score })),
          playerCount: session.players.length, maxPlayers: rc.maxP,
        });

        if (session.players.length >= rc.maxP) {
          const startTime = new Date(Date.now()+3000);
          session.status="starting"; session.startTime=startTime; await session.save();

          io.to(`s:${session._id}`).emit("game_start", {
            sessionId:session._id, boardSeed:session.boardSeed, startTime, duration:GAME_SECS,
            prize:rc.prize, roomName:rc.name, players: session.players.map(p=>({ name:p.name, userId:p.userId })),
          });

          const tid = setTimeout(async () => {
            const s = await GameSession.findById(session._id);
            if (s?.status==="in_progress") await endGame(io, s);
          }, 3000 + GAME_SECS*1000);
          gameTimers.set(session._id.toString(), tid);

          setTimeout(async () => { await GameSession.findByIdAndUpdate(session._id, { status:"in_progress" }); }, 3000);
        }
      } catch (e) { console.error("join_room:", e.message); socket.emit("error", { message:e.message }); }
    });

    socket.on("score_update", async ({ sessionId, score }) => {
      try {
        if (typeof score!=="number" || score<0) return;
        const session = await GameSession.findById(sessionId);
        if (!session || session.status!=="in_progress") return;

        const idx = session.players.findIndex(p=>p.userId.toString()===user._id.toString());
        if (idx===-1) return;

        const player = session.players[idx];
        const analysis = fraud.analyseScore({ player, newScore:score });

        if (analysis.suspicious) {
          console.warn(`⚠️  ${user.name} — ${analysis.issues.map(i=>i.detail).join(", ")}`);
          if (analysis.shouldDisqualify) {
            session.players[idx].flaggedForCheat = true;
            await session.save();
            await fraud.flagUser({ userId:user._id, sessionId:session._id, score, reason: analysis.issues[0]?.detail||"Score anomaly" });
            socket.emit("disqualified", { reason:"Suspicious score detected. You have been disqualified." });
            io.to(`s:${sessionId}`).emit("score_broadcast", { scoreboard: session.players.map(p=>({ name:p.name, userId:p.userId, score:p.score, flagged:p.flaggedForCheat })) });
            return;
          }
        }

        session.players[idx].score = score;
        session.players[idx].lastScoreCheck = score;
        session.players[idx].lastCheckTime = new Date();
        session.players[idx].scoreHistory.push({ score, ts:new Date() });
        await session.save();

        io.to(`s:${sessionId}`).emit("score_broadcast", { scoreboard: session.players.map(p=>({ name:p.name, userId:p.userId, score:p.score, flagged:p.flaggedForCheat })) });
      } catch (e) { console.error("score_update:", e.message); }
    });

    socket.on("send_emoji", async ({ sessionId, emoji }) => {
      try {
        if (!ALLOWED_EMOJIS.includes(emoji)) return;
        const now = Date.now();
        const last = emojiCooldown.get(socket.id) || 0;
        if (now-last < 2000) return socket.emit("emoji_throttled", { wait: Math.ceil((2000-(now-last))/1000) });
        emojiCooldown.set(socket.id, now);

        const session = await GameSession.findById(sessionId);
        if (!session || session.status!=="in_progress") return;
        if (!session.players.some(p=>p.userId.toString()===user._id.toString())) return;

        session.emojiLog.push({ fromName:user.name, emoji });
        await session.save();

        io.to(`s:${sessionId}`).emit("emoji_received", { fromName:user.name, fromId:user._id, emoji, ts:new Date() });
      } catch (e) { console.error("send_emoji:", e.message); }
    });

    const handleLeave = async (sessionId) => {
      try {
        if (!sessionId) return;
        const session = await GameSession.findById(sessionId);
        if (!session) return;

        if (session.status==="waiting") {
          const idx = session.players.findIndex(p=>p.userId.toString()===user._id.toString());
          if (idx!==-1) {
            const dbUser = await User.findById(user._id);
            dbUser.balance += session.entryFee; await dbUser.save();
            await Transaction.create({
              userId:user._id, type:"refund", amount:session.entryFee, description:`Refund — Left ${session.roomName}`,
              status:"completed", balanceBefore:dbUser.balance-session.entryFee, balanceAfter:dbUser.balance, completedAt:new Date(),
            });
            session.players.splice(idx,1);
            if (!session.players.length) session.status="cancelled";
            await session.save();
            socket.emit("refunded", { amount: session.entryFee });
          }
        }

        socket.leave(`s:${sessionId}`);
        io.to(`s:${sessionId}`).emit("player_left", { name:user.name });

        const dbUser = await User.findById(user._id);
        dbUser.setCooldown(session.roomId, CD_SECS); await dbUser.save();
      } catch (e) { console.error("handleLeave:", e.message); }
    };

    socket.on("leave_room", ({ sessionId }) => handleLeave(sessionId));
    socket.on("disconnect", () => {
      emojiCooldown.delete(socket.id);
      if (socket.data.sessionId) handleLeave(socket.data.sessionId);
      console.log(`🔌 ${user.name} disconnected`);
    });
  });

  console.log("🎮 Socket.io game engine ready");
};

module.exports = { initGameSocket };
