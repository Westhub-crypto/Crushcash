const express     = require("express");
const User        = require("../models/User");
const GameSession = require("../models/GameSession");
const { protect } = require("../middleware/auth");

const router = express.Router();

const ROOMS = [
  {id:1,name:"Starter Arena",entry:100,maxP:2,prize:160,cut:40},{id:2,name:"Bronze Arena",entry:200,maxP:2,prize:320,cut:80},
  {id:3,name:"Silver Arena",entry:500,maxP:2,prize:800,cut:200},{id:4,name:"Gold Arena",entry:1000,maxP:2,prize:1600,cut:400},
  {id:5,name:"Platinum Arena",entry:2000,maxP:2,prize:3200,cut:800},{id:6,name:"Diamond Arena",entry:5000,maxP:2,prize:8000,cut:2000},
  {id:7,name:"Elite Arena",entry:10000,maxP:2,prize:16000,cut:4000},{id:8,name:"Quad Bronze",entry:500,maxP:4,prize:1600,cut:400},
  {id:9,name:"Quad Gold",entry:2000,maxP:4,prize:6400,cut:1600},{id:10,name:"Quad Elite",entry:5000,maxP:4,prize:16000,cut:4000},
];

router.get("/rooms", async (req, res) => {
  const active = await GameSession.aggregate([
    { $match: { status: { $in:["waiting","in_progress"] } } },
    { $group: { _id:"$roomId", players: { $sum: { $size:"$players" } } } },
  ]);
  const map = {}; active.forEach(a => { map[a._id] = a.players; });
  res.json({ success:true, rooms: ROOMS.map(r => ({ ...r, totalPot:r.entry*r.maxP, activePlayers:map[r.id]||0 })) });
});

router.get("/cooldown/:roomId", protect, async (req, res) => {
  const user = await User.findById(req.user._id);
  const rem = user.cooldownRemaining(req.params.roomId);
  res.json({ success:true, hasCooldown: rem>0, remainingSeconds: rem });
});

router.post("/join/:roomId", protect, async (req, res) => {
  try {
    const room = ROOMS.find(r => r.id === Number(req.params.roomId));
    if (!room) return res.status(404).json({ success:false, error:"Room not found" });

    const user = await User.findById(req.user._id);
    const cd = user.cooldownRemaining(room.id);
    if (cd > 0) return res.status(429).json({ success:false, error:`Cooldown: ${Math.ceil(cd/60)} min remaining`, cooldownRemaining: cd });
    if (user.balance < room.entry) return res.status(400).json({ success:false, error:"Insufficient balance" });

    let session = await GameSession.findOne({ roomId: room.id, status:"waiting", $expr: { $lt:[{ $size:"$players" }, room.maxP] } });
    if (!session) session = await GameSession.create({
      roomId: room.id, roomName: room.name, entryFee: room.entry, prize: room.prize,
      platformCut: room.cut, maxPlayers: room.maxP, totalPot: room.entry * room.maxP,
      boardSeed: Math.random().toString(36).slice(2),
    });

    res.json({ success:true, sessionId: session._id, roomId: room.id });
  } catch (err) {
    console.error("Join room error:", err.message);
    res.status(500).json({ success:false, error: err.message });
  }
});

router.get("/history", protect, async (req, res) => {
  const { page=1, limit=10 } = req.query;
  const sessions = await GameSession.find({ "players.userId": req.user._id, status:"completed" })
    .sort({ createdAt:-1 }).skip((page-1)*limit).limit(Number(limit)).lean();
  const history = sessions.map(s => {
    const me = s.players.find(p => p.userId.toString()===req.user._id.toString());
    return { sessionId:s._id, roomName:s.roomName, entryFee:s.entryFee, prize:s.prize, myScore:me?.score||0, myResult:me?.result||"pending", winner:s.winnerName, playedAt:s.createdAt };
  });
  res.json({ success:true, history });
});

router.get("/leaderboard", async (req, res) => {
  const leaders = await User.find({ isBanned:false }).select("name totalWon totalGames").sort({ totalWon:-1 }).limit(20).lean();
  res.json({ success:true, leaderboard: leaders.map((u,i) => ({ rank:i+1, ...u })) });
});

module.exports = router;
   
