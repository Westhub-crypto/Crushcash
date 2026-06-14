const jwt         = require("jsonwebtoken");
const User        = require("../models/User");
const Referral    = require("../models/Referral");
const GameSession = require("../models/GameSession");
const Transaction = require("../models/Transaction");
const fraud       = require("../services/fraud");
const { ROOMS, getRoom } = require("../config/rooms");

const GAME_SECS       = Number(process.env.GAME_DURATION_SECONDS)    || 120;
const CD_SECS         = Number(process.env.COOLDOWN_DURATION_SECONDS) || 60;
const REFERRAL_REWARD = Number(process.env.REFERRAL_REWARD)           || 50;
const BOT_WAIT_SECS   = 8; // seconds to wait for a real opponent before spawning bot

const ALLOWED_EMOJIS = ["😂","🔥","💀","👑","🎮","😤","🏆","😎","💪","🍬","😱","❤️","🤣","😈","🙌"];

// Large pool of real Nigerian first names — used for bots so they look human
const BOT_NAME_POOL = [
  "Chukwuemeka","Adaeze","Oluwaseun","Blessing","Emeka","Chiamaka","Tunde","Ngozi",
  "Femi","Amara","Segun","Chidinma","Uche","Aisha","Babatunde","Funmilayo","Ikechukwu",
  "Yetunde","Obinna","Adaora","Kunle","Chisom","Rotimi","Nnenna","Gbenga","Ebunoluwa",
  "Kelechi","Ifeoma","Chidi","Adunola","Taiwo","Sade","Wale","Bola","Chinyere","Dayo",
  "Kola","Lola","Musa","Nkechi","Obi","Remi","Simbi","Toyin","Usman","Wunmi","Yinka",
  "Zainab","Ifeanyi","Adeola","Bukola","Chinonso","Dele","Esther","Fatima","Godwin",
  "Habiba","Ijele","Jide","Kehinde","Lawal","Moyo","Nnamdi","Oge","Patience","Qudus",
  "Rasaq","Sandra","Timothy","Uju","Victor","Wasiu","Xena","Yusuf","Zara","Adebayo",
];

// Pick N unique names from the pool (never duplicate within a session)
const pickBotNames = (n) => {
  const shuffled = [...BOT_NAME_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
};

const gameTimers     = new Map();
const botTimers      = new Map();
const botScoreTimers = new Map();
const emojiCooldown  = new Map();

const authSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select("-password");
    if (!user || user.isBanned) return next(new Error("Unauthorized"));
    socket.user = user;
    next();
  } catch { next(new Error("Auth failed")); }
};

// ── Pay winner ────────────────────────────────────────────
const payWinner = async (session, winner) => {
  try {
    if (winner.isBot) return true; // house keeps fees when bot wins

    const user = await User.findById(winner.userId);
    if (!user) return false;

    const before     = user.balance;
    user.balance    += session.prize;
    user.totalWon   += 1;
    user.totalGames += 1;
    await user.save();

    await Transaction.create({
      userId: user._id, type:"game_win", amount: session.prize,
      description:`🏆 Won — ${session.roomName}`, status:"completed",
      gameSessionId: session._id, roomId: session.roomId,
      balanceBefore: before, balanceAfter: user.balance, completedAt: new Date(),
    });

    // Referral reward on first game played
    if (!user.firstGamePlayed) {
      user.firstGamePlayed = true;
      await user.save();
      const ref = await Referral.findOne({ referredId: user._id, status:{ $in:["registered","played"] } });
      if (ref && !ref.referrerPaid) {
        const referrer = await User.findById(ref.referrerId);
        if (referrer && !referrer.isBanned) {
          referrer.balance          += REFERRAL_REWARD;
          referrer.referralEarnings += REFERRAL_REWARD;
          await referrer.save();
          await Transaction.create({
            userId: referrer._id, type:"referral_reward", amount: REFERRAL_REWARD,
            description:`🎁 Referral reward — ${user.name} played their first game`,
            status:"completed", reference:`REF_${ref._id}`,
            balanceBefore: referrer.balance - REFERRAL_REWARD,
            balanceAfter:  referrer.balance, completedAt: new Date(),
          });
          ref.status = "rewarded"; ref.referrerPaid = true; ref.referrerPaidAt = new Date();
          await ref.save();
        }
      }
    }

    // Increment game count for human losers
    await Promise.all(
      session.players
        .filter(p => !p.isBot && String(p.userId) !== String(winner.userId))
        .map(p => User.findByIdAndUpdate(p.userId, { $inc:{ totalGames:1 } }))
    );
    return true;
  } catch (e) { console.error("payWinner:", e.message); return false; }
};

// ── End game ──────────────────────────────────────────────
const endGame = async (io, session) => {
  try {
    clearTimeout(gameTimers.get(String(session._id)));
    gameTimers.delete(String(session._id));
    clearInterval(botScoreTimers.get(String(session._id)));
    botScoreTimers.delete(String(session._id));

    const valid = session.players.filter(p => !p.flaggedForCheat);
    if (!valid.length) {
      session.status = "cancelled"; await session.save();
      io.to(`s:${session._id}`).emit("game_over", { cancelled:true });
      return;
    }

    const winner   = valid.reduce((b, p) => p.score > b.score ? p : b, valid[0]);
    const rankings = [...session.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({
        rank: i+1, name: p.name, score: p.score,
        userId: p.userId, isBot: p.isBot,
        isWinner: String(p.userId) === String(winner.userId),
        flagged: p.flaggedForCheat,
      }));

    session.status      = "completed";
    session.endTime     = new Date();
    session.winnerId    = winner.isBot ? null : winner.userId;
    session.winnerName  = winner.name;
    session.winnerScore = winner.score;
    await session.save();

    const paid = await payWinner(session, winner);

    // If bot wins, still increment game count for humans
    if (winner.isBot) {
      await Promise.all(
        session.players.filter(p => !p.isBot)
          .map(p => User.findByIdAndUpdate(p.userId, { $inc:{ totalGames:1 } }))
      );
    }

    io.to(`s:${session._id}`).emit("game_over", {
      rankings,
      winner: { name:winner.name, score:winner.score, userId:winner.userId, isBot:winner.isBot },
      prize: session.prize, payoutSuccess: paid,
    });

    console.log(`🎮 OVER | ${session.roomName} | 🏆 ${winner.name} ${winner.score}pts${winner.isBot?" [bot]":""}`);
  } catch (e) { console.error("endGame:", e.message); }
};

// ── Bot scoring: 3-phase difficulty ───────────────────────
// Phase 1 (0–30s):   Slow warm-up.  Looks like player is just finding matches.
// Phase 2 (30–90s):  Moderate pace. Neck and neck with an average player.
// Phase 3 (90–120s): Final sprint.  Hits hard in the last 30 seconds.
const startBotScoring = (io, sessionId) => {
  const TICK_MS   = 1800;
  let   tick      = 0;
  const totalTicks = Math.floor((GAME_SECS * 1000) / TICK_MS);

  const iv = setInterval(async () => {
    tick++;
    if (tick > totalTicks) { clearInterval(iv); return; }

    const elapsed   = tick * (TICK_MS / 1000);   // seconds since game start
    const remaining = GAME_SECS - elapsed;

    try {
      const session = await GameSession.findById(sessionId);
      if (!session || session.status !== "in_progress") { clearInterval(iv); return; }

      let changed = false;
      for (const p of session.players) {
        if (!p.isBot) continue;

        let inc = 0;

        if (elapsed <= 30) {
          // Phase 1 — warm up (casual start)
          inc = 15 + Math.floor(Math.random() * 35);                  // 15–50 pts
          if (Math.random() < 0.07) inc += 20 + Math.floor(Math.random() * 20); // rare small combo
        } else if (remaining > 30) {
          // Phase 2 — steady mid-game (human-like)
          inc = 35 + Math.floor(Math.random() * 55);                  // 35–90 pts
          if (Math.random() < 0.18) inc += 50 + Math.floor(Math.random() * 70); // occasional combo
          if (Math.random() < 0.06) inc = 0;                          // occasional miss → feels human
        } else {
          // Phase 3 — final 30s sprint (aggressive finish)
          inc = 70 + Math.floor(Math.random() * 80);                  // 70–150 pts
          if (Math.random() < 0.40) inc += 90 + Math.floor(Math.random() * 110); // frequent big combos
          // No misses — bot is fully focused now
        }

        p.score          += inc;
        p.lastCheckTime   = new Date();
        p.lastScoreCheck  = p.score;
        changed = true;
      }

      if (changed) {
        await session.save();
        io.to(`s:${sessionId}`).emit("score_broadcast", {
          scoreboard: session.players.map(p => ({
            name:p.name, userId:p.userId, score:p.score,
            flagged:p.flaggedForCheat, isBot:p.isBot,
          })),
        });
      }
    } catch (e) { console.error("botScoring:", e.message); }
  }, TICK_MS);

  botScoreTimers.set(String(sessionId), iv);
};

// ── Spawn bots to fill ALL empty slots ────────────────────
// Works for both 1v1 (1 bot) and quad rooms (up to 3 bots)
const maybeSpawnBots = (io, session, rc) => {
  const tid = setTimeout(async () => {
    try {
      const s = await GameSession.findById(session._id);
      if (!s || s.status !== "waiting") return;

      const humanCount  = s.players.filter(p => !p.isBot).length;
      const slotsToFill = rc.maxP - s.players.length;
      if (slotsToFill <= 0) return;

      // Pick unique names for however many bots we need
      const botNames = pickBotNames(slotsToFill);

      for (let i = 0; i < slotsToFill; i++) {
        s.players.push({
          userId:        `bot_${Date.now()}_${i}`,
          name:          botNames[i],
          score:         0,
          hasJoined:     true,
          isBot:         true,
          lastCheckTime: new Date(),
        });
      }

      s.status    = "starting";
      s.startTime = new Date(Date.now() + 3000);
      await s.save();

      const playerList = s.players.map(p => ({ name:p.name, userId:p.userId, score:p.score, isBot:p.isBot }));

      io.to(`s:${s._id}`).emit("room_joined", {
        sessionId:   s._id, boardSeed: s.boardSeed,
        players:     playerList,
        playerCount: s.players.length, maxPlayers: rc.maxP,
      });

      io.to(`s:${s._id}`).emit("game_start", {
        sessionId: s._id, boardSeed: s.boardSeed,
        startTime: s.startTime, duration: GAME_SECS,
        prize: rc.prize, roomName: rc.name,
        players: playerList,
      });

      const endTid = setTimeout(async () => {
        const fresh = await GameSession.findById(s._id);
        if (fresh?.status === "in_progress") await endGame(io, fresh);
      }, 3000 + GAME_SECS * 1000);
      gameTimers.set(String(s._id), endTid);

      setTimeout(async () => {
        await GameSession.findByIdAndUpdate(s._id, { status:"in_progress" });
        startBotScoring(io, s._id);
      }, 3000);

      const botNames_ = s.players.filter(p => p.isBot).map(p => p.name).join(", ");
      console.log(`🤖 Spawned ${slotsToFill} bot(s) [${botNames_}] in ${rc.name} (${humanCount} human player(s))`);
    } catch (e) { console.error("maybeSpawnBots:", e.message); }
  }, BOT_WAIT_SECS * 1000);

  botTimers.set(String(session._id), tid);
};

// ══ MAIN ══════════════════════════════════════════════════
const initGameSocket = (io) => {
  io.use(authSocket);

  io.on("connection", socket => {
    const user = socket.user;
    console.log(`🔌 ${user.name} connected`);

    // ── JOIN ROOM ────────────────────────────────────────
    socket.on("join_room", async ({ roomId, sessionId }) => {
      try {
        const rc = getRoom(roomId);
        if (!rc) return socket.emit("error", { message:"Invalid room" });

        const dbUser = await User.findById(user._id);
        const cd     = dbUser.cooldownRemaining(roomId);
        if (cd > 0)              return socket.emit("error", { message:`Cooldown: ${Math.ceil(cd/60)} min remaining`, cooldownRemaining:cd });
        if (dbUser.balance < rc.entry) return socket.emit("error", { message:`You need ₦${rc.entry.toLocaleString()} to enter` });

        // Find an existing waiting session or create one
        let session = sessionId
          ? await GameSession.findById(sessionId)
          : await GameSession.findOne({ roomId, status:"waiting", $expr:{ $lt:[{ $size:"$players" }, rc.maxP] } });

        if (!session) {
          session = await GameSession.create({
            roomId, roomName: rc.name, entryFee: rc.entry, prize: rc.prize,
            platformCut: rc.cut, maxPlayers: rc.maxP, totalPot: rc.totalPot,
            boardSeed: Math.random().toString(36).slice(2),
          });
        }

        // Already in session
        if (session.players.some(p => String(p.userId) === String(user._id))) {
          socket.join(`s:${session._id}`);
          return socket.emit("room_joined", { sessionId:session._id, players:session.players, alreadyJoined:true });
        }

        if (session.status !== "waiting" || session.players.length >= rc.maxP)
          return socket.emit("error", { message:"Room just filled up, please try again" });

        // Deduct entry fee
        const before    = dbUser.balance;
        dbUser.balance -= rc.entry;
        await dbUser.save();
        await Transaction.create({
          userId:user._id, type:"game_entry", amount:rc.entry, description:`Entry — ${rc.name}`,
          status:"completed", gameSessionId:session._id, roomId,
          balanceBefore:before, balanceAfter:dbUser.balance, completedAt:new Date(),
        });

        session.players.push({
          userId: user._id, name: user.name, score: 0,
          hasJoined: true, isBot: false, socketId: socket.id,
          lastCheckTime: new Date(),
        });
        await session.save();

        socket.join(`s:${session._id}`);
        socket.data.sessionId = String(session._id);
        socket.data.roomId    = roomId;

        io.to(`s:${session._id}`).emit("room_joined", {
          sessionId: session._id, boardSeed: session.boardSeed,
          players: session.players.map(p => ({ name:p.name, userId:p.userId, score:p.score, isBot:p.isBot })),
          playerCount: session.players.length, maxPlayers: rc.maxP,
        });

        const humanPlayers = session.players.filter(p => !p.isBot).length;

        if (humanPlayers >= rc.maxP) {
          // All slots filled by humans — start immediately
          clearTimeout(botTimers.get(String(session._id)));
          botTimers.delete(String(session._id));

          const startTime   = new Date(Date.now() + 3000);
          session.status    = "starting";
          session.startTime = startTime;
          await session.save();

          io.to(`s:${session._id}`).emit("game_start", {
            sessionId: session._id, boardSeed: session.boardSeed,
            startTime, duration: GAME_SECS,
            prize: rc.prize, roomName: rc.name,
            players: session.players.map(p => ({ name:p.name, userId:p.userId, isBot:p.isBot })),
          });

          const tid = setTimeout(async () => {
            const s = await GameSession.findById(session._id);
            if (s?.status === "in_progress") await endGame(io, s);
          }, 3000 + GAME_SECS * 1000);
          gameTimers.set(String(session._id), tid);

          setTimeout(async () => {
            await GameSession.findByIdAndUpdate(session._id, { status:"in_progress" });
          }, 3000);
        } else {
          // Not full yet — start bot timer.
          // For quad rooms this fills ALL remaining empty slots after BOT_WAIT_SECS.
          maybeSpawnBots(io, session, rc);
        }
      } catch (e) { console.error("join_room:", e.message); socket.emit("error", { message:e.message }); }
    });

    // ── SCORE UPDATE ─────────────────────────────────────
    socket.on("score_update", async ({ sessionId, score }) => {
      try {
        if (typeof score !== "number" || score < 0) return;
        const session = await GameSession.findById(sessionId);
        if (!session || session.status !== "in_progress") return;

        const idx = session.players.findIndex(p => String(p.userId) === String(user._id));
        if (idx === -1) return;

        const player   = session.players[idx];
        const analysis = fraud.analyseScore({ player, newScore:score });

        if (analysis.suspicious) {
          console.warn(`⚠️  ${user.name}: ${analysis.issues.map(i=>i.detail).join(", ")}`);
          if (analysis.shouldDisqualify) {
            session.players[idx].flaggedForCheat = true;
            await session.save();
            await fraud.flagUser({ userId:user._id, sessionId:session._id, score, reason:analysis.issues[0]?.detail||"Score anomaly" });
            socket.emit("disqualified", { reason:"Suspicious score detected. You have been disqualified." });
            io.to(`s:${sessionId}`).emit("score_broadcast", {
              scoreboard: session.players.map(p => ({ name:p.name, userId:p.userId, score:p.score, flagged:p.flaggedForCheat, isBot:p.isBot })),
            });
            return;
          }
        }

        session.players[idx].score         = score;
        session.players[idx].lastScoreCheck = score;
        session.players[idx].lastCheckTime  = new Date();
        session.players[idx].scoreHistory?.push({ score, ts:new Date() });
        await session.save();

        io.to(`s:${sessionId}`).emit("score_broadcast", {
          scoreboard: session.players.map(p => ({ name:p.name, userId:p.userId, score:p.score, flagged:p.flaggedForCheat, isBot:p.isBot })),
        });
      } catch (e) { console.error("score_update:", e.message); }
    });

    // ── EMOJI ────────────────────────────────────────────
    socket.on("send_emoji", async ({ sessionId, emoji }) => {
      try {
        if (!ALLOWED_EMOJIS.includes(emoji)) return;
        const now  = Date.now();
        const last = emojiCooldown.get(socket.id) || 0;
        if (now - last < 2000) return socket.emit("emoji_throttled", { wait: Math.ceil((2000-(now-last))/1000) });
        emojiCooldown.set(socket.id, now);

        const session = await GameSession.findById(sessionId);
        if (!session || session.status !== "in_progress") return;
        if (!session.players.some(p => String(p.userId) === String(user._id))) return;

        session.emojiLog.push({ fromName:user.name, emoji });
        await session.save();
        io.to(`s:${sessionId}`).emit("emoji_received", { fromName:user.name, fromId:user._id, emoji, ts:new Date() });

        // Each bot replies independently with 45% probability
        session.players.filter(p => p.isBot).forEach(bot => {
          if (Math.random() < 0.45) {
            setTimeout(() => {
              const reply = ALLOWED_EMOJIS[Math.floor(Math.random() * ALLOWED_EMOJIS.length)];
              io.to(`s:${sessionId}`).emit("emoji_received", { fromName:bot.name, fromId:bot.userId, emoji:reply, ts:new Date() });
            }, 400 + Math.random() * 1200);
          }
        });
      } catch (e) { console.error("send_emoji:", e.message); }
    });

    // ── LEAVE ────────────────────────────────────────────
    const handleLeave = async (sessionId) => {
      try {
        if (!sessionId) return;
        clearTimeout(botTimers.get(sessionId));
        botTimers.delete(sessionId);

        const session = await GameSession.findById(sessionId);
        if (!session) return;

        if (session.status === "waiting") {
          const idx = session.players.findIndex(p => String(p.userId) === String(user._id));
          if (idx !== -1) {
            const dbUser   = await User.findById(user._id);
            const before   = dbUser.balance;
            dbUser.balance += session.entryFee;
            await dbUser.save();
            await Transaction.create({
              userId:user._id, type:"refund", amount:session.entryFee,
              description:`Refund — Left ${session.roomName}`, status:"completed",
              balanceBefore:before, balanceAfter:dbUser.balance, completedAt:new Date(),
            });
            session.players.splice(idx, 1);
            if (!session.players.length) session.status = "cancelled";
            await session.save();
            socket.emit("refunded", { amount:session.entryFee });
          }
        }

        socket.leave(`s:${sessionId}`);
        io.to(`s:${sessionId}`).emit("player_left", { name:user.name });

        const dbUser = await User.findById(user._id);
        dbUser.setCooldown(session.roomId, CD_SECS);
        await dbUser.save();
      } catch (e) { console.error("handleLeave:", e.message); }
    };

    socket.on("leave_room",  ({ sessionId }) => handleLeave(sessionId));
    socket.on("disconnect",  () => {
      emojiCooldown.delete(socket.id);
      if (socket.data.sessionId) handleLeave(socket.data.sessionId);
      console.log(`🔌 ${user.name} disconnected`);
    });
  });

  console.log("🎮 Socket.io game engine ready (bot matchmaking · quad support)");
};

module.exports = { initGameSocket };
