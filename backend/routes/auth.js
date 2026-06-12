const express     = require("express");
const jwt         = require("jsonwebtoken");
const User        = require("../models/User");
const Referral    = require("../models/Referral");
const Transaction = require("../models/Transaction");
const { protect } = require("../middleware/auth");

const router   = express.Router();
const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
const BONUS    = Number(process.env.SIGNUP_BONUS) || 500;

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone, referralCode } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success:false, error:"Name, email and password required" });
    if (password.length < 6)
      return res.status(400).json({ success:false, error:"Password must be 6+ characters" });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ success:false, error:"Email already registered" });

    let referrer = null;
    if (referralCode) referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });

    const user = await User.create({ name, email, password, phone, balance: BONUS, referredBy: referrer?._id });

    await Transaction.create({
      userId: user._id, type:"bonus", amount: BONUS, description:"🎉 Sign-up Bonus",
      status:"completed", reference:`SIGNUP_${user._id}`, balanceBefore:0, balanceAfter:BONUS, completedAt:new Date(),
    });

    if (referrer) {
      await Referral.create({ referrerId: referrer._id, referredId: user._id, referralCode: referralCode.toUpperCase(), signupBonusPaid:true });
    }

    res.status(201).json({ success:true, token: signToken(user._id), user: user.toSafeJSON() });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ success:false, error: "DEBUG: " + err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success:false, error:"Email and password required" });

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success:false, error:"Invalid email or password" });
    if (user.isBanned)
      return res.status(403).json({ success:false, error: user.banReason || "Account suspended. Contact support." });

    user.lastActive = new Date();
    await user.save();

    res.json({ success:true, token: signToken(user._id), user: user.toSafeJSON() });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success:false, error: "DEBUG: " + err.message });
  }
});

router.get("/me", protect, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success:true, user: user.toSafeJSON() });
});

router.put("/bank", protect, async (req, res) => {
  try {
    const { bankName, bankCode, accountNumber, accountName } = req.body;
    if (!bankName || !bankCode || !accountNumber || !accountName)
      return res.status(400).json({ success:false, error:"All bank fields required" });
    const user = await User.findByIdAndUpdate(req.user._id, { bankAccount:{ bankName, bankCode, accountNumber, accountName } }, { new:true });
    res.json({ success:true, user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to update bank" });
  }
});

router.put("/password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length<6)
      return res.status(400).json({ success:false, error:"Valid passwords required (min 6 chars)" });
    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.comparePassword(currentPassword)))
      return res.status(401).json({ success:false, error:"Current password incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ success:true, message:"Password updated" });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to update password" });
  }
});

module.exports = router;
                                
