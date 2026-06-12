const express      = require("express");
const User         = require("../models/User");
const Transaction  = require("../models/Transaction");
const GameSession  = require("../models/GameSession");
const Referral     = require("../models/Referral");
const { protect, adminOnly } = require("../middleware/auth");
const { getFraudReport } = require("../services/fraud");

const router = express.Router();
router.use(protect, adminOnly);

router.get("/stats", async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const [totalUsers, activeToday, deposits, prizes, entries, todayDeposits, todayGames, fraudUsers] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ lastActive: { $gte: today } }),
    Transaction.aggregate([{$match:{type:"deposit",status:"completed"}},{$group:{_id:null,t:{$sum:"$amount"}}}]),
    Transaction.aggregate([{$match:{type:"game_win",status:"completed"}},{$group:{_id:null,t:{$sum:"$amount"}}}]),
    Transaction.aggregate([{$match:{type:"game_entry",status:"completed"}},{$group:{_id:null,t:{$sum:"$amount"}}}]),
    Transaction.aggregate([{$match:{type:"deposit",status:"completed",createdAt:{$gte:today}}},{$group:{_id:null,t:{$sum:"$amount"}}}]),
    GameSession.countDocuments({ status:"completed", createdAt:{ $gte:today } }),
    User.countDocuments({ fraudFlags: { $gt:0 } }),
  ]);
  const entryTotal = entries[0]?.t || 0;
  res.json({ success:true, stats:{
    users:{ total:totalUsers, activeToday },
    revenue:{ totalDeposits:deposits[0]?.t||0, totalPrizes:prizes[0]?.t||0, totalEntries:entryTotal, platform:entryTotal*0.20, todayDeposits:todayDeposits[0]?.t||0 },
    games:{ completedToday:todayGames },
    fraud:{ flaggedUsers:fraudUsers },
  }});
});

router.get("/users", async (req, res) => {
  const { page=1, limit=20, search, status } = req.query;
  const q = {};
  if (search) q.$or = [{ name: new RegExp(search,"i") }, { email: new RegExp(search,"i") }];
  if (status==="banned") q.isBanned = true;
  if (status==="flagged") q.fraudFlags = { $gt:0 };
  const [users, total] = await Promise.all([
    User.find(q).select("-password").sort({ createdAt:-1 }).skip((page-1)*limit).limit(Number(limit)).lean(),
    User.countDocuments(q),
  ]);
  res.json({ success:true, users, total });
});

router.patch("/users/:id/ban", async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id,
    { isBanned: req.body.ban, banReason: req.body.ban ? req.body.reason : undefined, fraudFlagged: req.body.ban ? undefined : false },
    { new:true }).select("-password");
  if (!user) return res.status(404).json({ success:false, error:"User not found" });
  res.json({ success:true, user });
});

router.post("/users/:id/credit", async (req, res) => {
  const { amount, reason } = req.body;
  if (!amount || amount<=0) return res.status(400).json({ success:false, error:"Valid amount required" });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success:false, error:"User not found" });
  const before = user.balance;
  user.balance += Number(amount); await user.save();
  await Transaction.create({ userId:user._id, type:"bonus", amount:Number(amount), description:reason||"Admin credit", status:"completed", balanceBefore:before, balanceAfter:user.balance, completedAt:new Date() });
  res.json({ success:true, newBalance:user.balance });
});

router.get("/fraud", async (req, res) => {
  const report = await getFraudReport();
  res.json({ success:true, flaggedUsers: report });
});

router.get("/transactions", async (req, res) => {
  const { page=1, limit=25, type, status } = req.query;
  const q = {};
  if (type) q.type = type;
  if (status) q.status = status;
  const [txns, total] = await Promise.all([
    Transaction.find(q).populate("userId","name email").sort({ createdAt:-1 }).skip((page-1)*limit).limit(Number(limit)).lean(),
    Transaction.countDocuments(q),
  ]);
  res.json({ success:true, transactions:txns, total });
});

router.get("/sessions", async (req, res) => {
  const { page=1, limit=20, status } = req.query;
  const q = status ? { status } : {};
  const [sessions, total] = await Promise.all([
    GameSession.find(q).sort({ createdAt:-1 }).skip((page-1)*limit).limit(Number(limit)).lean(),
    GameSession.countDocuments(q),
  ]);
  res.json({ success:true, sessions, total });
});

router.get("/referrals", async (req, res) => {
  const referrals = await Referral.find().populate("referrerId","name").populate("referredId","name").sort({ createdAt:-1 }).limit(50).lean();
  res.json({ success:true, referrals });
});

module.exports = router;
