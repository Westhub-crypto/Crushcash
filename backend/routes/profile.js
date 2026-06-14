const express     = require("express");
const User        = require("../models/User");
const { protect } = require("../middleware/auth");
const { NIGERIAN_BANKS } = require("../config/banks");

const router = express.Router();

// GET /api/profile
router.get("/", protect, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success:true, user: user.toSafeJSON() });
});

// PUT /api/profile — update name + phone
router.put("/", protect, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const update = {};
    if (name)  update.name  = name.trim();
    if (phone) update.phone = phone.trim();
    const user = await User.findByIdAndUpdate(req.user._id, update, { new:true });
    res.json({ success:true, user: user.toSafeJSON() });
  } catch (err) {
    console.error("Profile update:", err.message);
    res.status(500).json({ success:false, error:"Failed to update profile" });
  }
});

// GET /api/profile/banks — list of all Nigerian banks
router.get("/banks", protect, async (req, res) => {
  res.json({ success:true, banks: NIGERIAN_BANKS });
});

// PUT /api/profile/bank — save bank account
router.put("/bank", protect, async (req, res) => {
  try {
    const { bankName, bankCode, accountNumber, accountName } = req.body;
    if (!bankName || !bankCode || !accountNumber || !accountName)
      return res.status(400).json({ success:false, error:"All bank fields are required" });
    if (!/^\d{10}$/.test(accountNumber))
      return res.status(400).json({ success:false, error:"Account number must be exactly 10 digits" });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { bankAccount:{ bankName, bankCode, accountNumber, accountName } },
      { new:true }
    );
    res.json({ success:true, user: user.toSafeJSON() });
  } catch (err) {
    console.error("Bank save:", err.message);
    res.status(500).json({ success:false, error:"Failed to save bank account" });
  }
});

module.exports = router;
  
