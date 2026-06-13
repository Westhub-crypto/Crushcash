const express     = require("express");
const { v4: uuid} = require("uuid");
const User        = require("../models/User");
const Transaction = require("../models/Transaction");
const { protect } = require("../middleware/auth");
const squadco     = require("../services/squadco");
const { NIGERIAN_BANKS } = require("../config/banks");

const router = express.Router();

router.post("/deposit/initiate", protect, async (req, res) => {
  try {
    const amt = Number(req.body.amount);
    if (!amt || amt < 100) return res.status(400).json({ success:false, error:"Minimum deposit ₦100" });
    if (amt > 500000) return res.status(400).json({ success:false, error:"Maximum deposit ₦500,000" });

    const reference = `DEP_${uuid().replace(/-/g,"").toUpperCase().slice(0,16)}`;
    await Transaction.create({
      userId: req.user._id, type:"deposit", amount: amt, description:"Deposit via SquadCo",
      status:"pending", reference, balanceBefore: req.user.balance,
    });

    const origin = `${req.protocol}://${req.get("host")}`;
    const result = await squadco.initiatePayment({
      email: req.user.email, amountNaira: amt, reference,
      callbackUrl: `${origin}/wallet?ref=${reference}`,
      metadata: { name: req.user.name, userId: req.user._id },
    });

    res.json({ success:true, checkoutUrl: result.checkoutUrl, reference });
  } catch (err) {
    console.error("Deposit initiate error:", err.message);
    res.status(500).json({ success:false, error: err.message || "Failed to initiate deposit" });
  }
});

router.post("/deposit/verify", protect, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ success:false, error:"Reference required" });

    const txn = await Transaction.findOne({ reference, userId: req.user._id });
    if (!txn) return res.status(404).json({ success:false, error:"Transaction not found" });
    if (txn.status === "completed") return res.json({ success:true, alreadyCredited:true });

    const result = await squadco.verifyPayment(reference);
    if (!result.isSuccess) {
      txn.status = "failed"; await txn.save();
      return res.status(400).json({ success:false, error:"Payment not successful" });
    }

    const user = await User.findById(req.user._id);
    const before = user.balance;
    user.balance += result.amountNaira;
    await user.save();

    txn.status = "completed"; txn.squadcoRef = result.reference;
    txn.balanceBefore = before; txn.balanceAfter = user.balance; txn.completedAt = new Date();
    await txn.save();

    res.json({ success:true, newBalance:user.balance, amountCredited:result.amountNaira });
  } catch (err) {
    console.error("Deposit verify error:", err.message);
    res.status(500).json({ success:false, error: err.message || "Verification failed" });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const sig = req.headers["x-squad-encrypted-body"];
    const raw = req.body;
    if (!squadco.verifyWebhookSignature(raw, sig)) return res.status(401).json({ error:"Bad signature" });

    const event = JSON.parse(raw.toString());
    if (event.Event === "charge_completed" && event.Body?.transaction_status === "success") {
      const ref = event.Body.transaction_ref;
      const amount = squadco.toNaira(event.Body.amount);
      const txn = await Transaction.findOne({ reference: ref });
      if (!txn || txn.status === "completed") return res.sendStatus(200);

      const user = await User.findById(txn.userId);
      if (!user) return res.sendStatus(200);

      const before = user.balance;
      user.balance += amount; await user.save();
      txn.status = "completed"; txn.squadcoRef = ref;
      txn.balanceBefore = before; txn.balanceAfter = user.balance; txn.completedAt = new Date();
      await txn.save();
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// ── Withdraw: now requires email + phone verification (NOT NIN) ──
router.post("/withdraw", protect, async (req, res) => {
  try {
    const amt = Number(req.body.amount);
    if (!amt || amt < 500) return res.status(400).json({ success:false, error:"Minimum withdrawal ₦500" });

    const user = await User.findById(req.user._id);

    if (!user.emailVerified || !user.phoneVerified)
      return res.status(403).json({
        success:false,
        error:"Please verify your email and phone number before withdrawing.",
        verificationRequired:true,
      });

    if (user.balance < amt) return res.status(400).json({ success:false, error:"Insufficient balance" });
    if (!user.bankAccount?.accountNumber) return res.status(400).json({ success:false, error:"Please add a bank account first" });

    const reference = `WDR_${uuid().replace(/-/g,"").toUpperCase().slice(0,16)}`;
    const before = user.balance;
    user.balance -= amt; await user.save();

    const txn = await Transaction.create({
      userId: user._id, type:"withdrawal", amount: amt, description:`Withdrawal to ${user.bankAccount.bankName}`,
      status:"processing", reference, balanceBefore:before, balanceAfter:user.balance, metadata:{...user.bankAccount},
    });

    try {
      const result = await squadco.transferToBank({
        bankCode: user.bankAccount.bankCode, accountNumber: user.bankAccount.accountNumber,
        accountName: user.bankAccount.accountName, amountNaira: amt, reference,
      });
      txn.status = "completed"; txn.squadcoRef = result.reference; txn.completedAt = new Date();
      await txn.save();
    } catch (transferErr) {
      user.balance += amt; await user.save();
      txn.status = "failed"; await txn.save();
      throw transferErr;
    }

    res.json({ success:true, message:`₦${amt.toLocaleString()} withdrawal initiated`, newBalance:user.balance });
  } catch (err) {
    console.error("Withdraw error:", err.message);
    res.status(500).json({ success:false, error: err.message || "Withdrawal failed" });
  }
});

router.get("/balance", protect, async (req, res) => {
  const user = await User.findById(req.user._id).select("balance");
  res.json({ success:true, balance:user.balance });
});

router.get("/transactions", protect, async (req, res) => {
  const { page=1, limit=20 } = req.query;
  const [txns, total] = await Promise.all([
    Transaction.find({ userId: req.user._id }).sort({ createdAt:-1 }).skip((page-1)*limit).limit(Number(limit)).lean(),
    Transaction.countDocuments({ userId: req.user._id }),
  ]);
  res.json({ success:true, transactions:txns, total });
});

// Static Nigerian bank list — no external API needed
router.get("/banks", protect, async (req, res) => {
  res.json({ success:true, banks: NIGERIAN_BANKS });
});

router.post("/verify-account", protect, async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;
    const result = await squadco.lookupBankAccount(bankCode, accountNumber);
    res.json({ success:true, accountName: result.accountName });
  } catch (err) {
    res.status(500).json({ success:false, error: err.message });
  }
});

module.exports = router;
    
