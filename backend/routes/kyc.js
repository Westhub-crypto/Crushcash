const express     = require("express");
const User        = require("../models/User");
const { protect } = require("../middleware/auth");
const { verifyNIN, maskNIN, validateNINFormat } = require("../services/nin");

const router = express.Router();

router.post("/submit", protect, async (req, res) => {
  try {
    const { nin } = req.body;
    const user = await User.findById(req.user._id);
    if (user.kycStatus === "verified") return res.status(400).json({ success:false, error:"KYC already verified" });
    if (user.kycStatus === "pending") return res.status(400).json({ success:false, error:"KYC verification in progress" });

    const fmt = validateNINFormat(nin);
    if (!fmt.valid) return res.status(400).json({ success:false, error: fmt.error });

    const nameParts = user.name.trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName  = nameParts[nameParts.length-1] || "";

    user.kycStatus = "pending"; await user.save();

    const result = await verifyNIN({ nin: fmt.nin, firstName, lastName });
    if (!result.success) {
      user.kycStatus = "rejected"; user.kycData = { rejectedReason: result.error }; await user.save();
      return res.status(400).json({ success:false, error: result.error });
    }

    user.kycStatus = "verified";
    user.kycData = { nin: maskNIN(fmt.nin), verifiedAt: new Date() };
    await user.save();

    res.json({ success:true, message:"KYC verified successfully! You can now make withdrawals.", kycStatus:"verified", devMode: result.devMode||false });
  } catch (err) {
    console.error("KYC submit error:", err.message);
    await User.findByIdAndUpdate(req.user._id, { kycStatus:"none" });
    res.status(500).json({ success:false, error:"Verification failed. Please try again." });
  }
});

router.get("/status", protect, async (req, res) => {
  const user = await User.findById(req.user._id).select("kycStatus kycData");
  res.json({ success:true, kycStatus:user.kycStatus, verifiedAt:user.kycData?.verifiedAt, rejectedReason:user.kycData?.rejectedReason });
});

module.exports = router;
