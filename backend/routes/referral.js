const express  = require("express");
const User     = require("../models/User");
const Referral = require("../models/Referral");
const { protect } = require("../middleware/auth");
const router = express.Router();

router.get("/my", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("referralCode referralEarnings");
    const [total, rewarded, pending] = await Promise.all([
      Referral.countDocuments({ referrerId: req.user._id }),
      Referral.countDocuments({ referrerId: req.user._id, status:"rewarded" }),
      Referral.countDocuments({ referrerId: req.user._id, status: { $in:["registered","played"] } }),
    ]);
    res.json({
      success:true, referralCode:user.referralCode,
      referralLink: `${req.protocol}://${req.get("host")}?ref=${user.referralCode}`,
      totalReferrals:total, rewardedCount:rewarded, pendingCount:pending, totalEarned:user.referralEarnings,
    });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to fetch referral data" });
  }
});

router.get("/list", protect, async (req, res) => {
  try {
    const referrals = await Referral.find({ referrerId: req.user._id })
      .populate("referredId","name createdAt totalGames").sort({ createdAt:-1 }).limit(50).lean();
    res.json({ success:true, referrals });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to fetch referrals" });
  }
});

router.get("/validate/:code", async (req, res) => {
  try {
    const user = await User.findOne({ referralCode: req.params.code.toUpperCase() }).select("name referralCode");
    if (!user) return res.status(404).json({ success:false, error:"Invalid referral code" });
    res.json({ success:true, referrerName:user.name });
  } catch (err) {
    res.status(500).json({ success:false, error:"Validation failed" });
  }
});

module.exports = router;
