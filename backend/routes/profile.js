const express     = require("express");
const User        = require("../models/User");
const { protect } = require("../middleware/auth");
const { NIGERIAN_BANKS } = require("../config/banks");

const router = express.Router();

const genOtp = () => String(Math.floor(100000 + Math.random()*900000));

// ═══════════════════════════════════════════════
//  GET /api/profile  — full profile
// ═══════════════════════════════════════════════
router.get("/", protect, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success:true, user: user.toSafeJSON() });
});

// ═══════════════════════════════════════════════
//  PUT /api/profile  — update name / phone
// ═══════════════════════════════════════════════
router.put("/", protect, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const update = {};
    if (name)  update.name = name;
    if (phone && phone !== req.user.phone) { update.phone = phone; update.phoneVerified = false; }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new:true });
    res.json({ success:true, user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to update profile" });
  }
});

// ═══════════════════════════════════════════════
//  EMAIL VERIFICATION (OTP)
// ═══════════════════════════════════════════════
router.post("/email/send-otp", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.emailVerified) return res.status(400).json({ success:false, error:"Email already verified" });

    const otp = genOtp();
    user.emailOtp = otp;
    user.emailOtpExpires = new Date(Date.now() + 10*60*1000);
    await user.save();

    // NOTE: Plug in a real email provider here (e.g. Resend, SendGrid, Nodemailer+SMTP).
    // For now the OTP is returned directly so the flow works end-to-end without
    // extra paid services. Replace this with an actual email send in production.
    console.log(`📧 Email OTP for ${user.email}: ${otp}`);

    res.json({ success:true, message:"Verification code generated.", devOtp: otp });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to send code" });
  }
});

router.post("/email/verify", protect, async (req, res) => {
  try {
    const { otp } = req.body;
    const user = await User.findById(req.user._id).select("+emailOtp +emailOtpExpires");
    if (!user.emailOtp || !user.emailOtpExpires || user.emailOtpExpires < new Date())
      return res.status(400).json({ success:false, error:"Code expired. Please request a new one." });
    if (String(otp) !== user.emailOtp)
      return res.status(400).json({ success:false, error:"Incorrect code." });

    user.emailVerified = true;
    user.emailOtp = undefined;
    user.emailOtpExpires = undefined;
    await user.save();

    res.json({ success:true, message:"Email verified successfully!" });
  } catch (err) {
    res.status(500).json({ success:false, error:"Verification failed" });
  }
});

// ═══════════════════════════════════════════════
//  PHONE VERIFICATION (OTP)
// ═══════════════════════════════════════════════
router.post("/phone/send-otp", protect, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.replace(/\D/g,"").length < 10)
      return res.status(400).json({ success:false, error:"Enter a valid phone number" });

    const user = await User.findById(req.user._id);
    const otp = genOtp();
    user.phone = phone;
    user.phoneVerified = false;
    user.phoneOtp = otp;
    user.phoneOtpExpires = new Date(Date.now() + 10*60*1000);
    await user.save();

    // NOTE: Plug in a real SMS provider here (e.g. Termii, Africa's Talking, Twilio).
    console.log(`📱 Phone OTP for ${phone}: ${otp}`);

    res.json({ success:true, message:"Verification code generated.", devOtp: otp });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to send code" });
  }
});

router.post("/phone/verify", protect, async (req, res) => {
  try {
    const { otp } = req.body;
    const user = await User.findById(req.user._id).select("+phoneOtp +phoneOtpExpires");
    if (!user.phoneOtp || !user.phoneOtpExpires || user.phoneOtpExpires < new Date())
      return res.status(400).json({ success:false, error:"Code expired. Please request a new one." });
    if (String(otp) !== user.phoneOtp)
      return res.status(400).json({ success:false, error:"Incorrect code." });

    user.phoneVerified = true;
    user.phoneOtp = undefined;
    user.phoneOtpExpires = undefined;
    await user.save();

    res.json({ success:true, message:"Phone number verified successfully!" });
  } catch (err) {
    res.status(500).json({ success:false, error:"Verification failed" });
  }
});

// ═══════════════════════════════════════════════
//  BANKS  — full Nigerian bank list for dropdown
// ═══════════════════════════════════════════════
router.get("/banks", protect, async (req, res) => {
  res.json({ success:true, banks: NIGERIAN_BANKS });
});

// ═══════════════════════════════════════════════
//  PUT /api/profile/bank  — save bank account
// ═══════════════════════════════════════════════
router.put("/bank", protect, async (req, res) => {
  try {
    const { bankName, bankCode, accountNumber, accountName } = req.body;
    if (!bankName || !bankCode || !accountNumber || !accountName)
      return res.status(400).json({ success:false, error:"All bank fields are required" });
    if (!/^\d{10}$/.test(accountNumber))
      return res.status(400).json({ success:false, error:"Account number must be 10 digits" });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { bankAccount: { bankName, bankCode, accountNumber, accountName } },
      { new:true }
    );
    res.json({ success:true, user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ success:false, error:"Failed to save bank account" });
  }
});

module.exports = router;
