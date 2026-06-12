const mongoose = require("mongoose");
const referralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  referredId: { type: mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  referralCode: { type:String, required:true },
  signupBonus: { type:Number, default:500 },
  referrerBonus: { type:Number, default:50 },
  status: { type:String, enum:["registered","played","rewarded"], default:"registered" },
  signupBonusPaid: { type:Boolean, default:false },
  referrerPaid: { type:Boolean, default:false },
  referrerPaidAt: { type:Date },
  createdAt: { type:Date, default:Date.now },
});
referralSchema.index({ referrerId:1 });
module.exports = mongoose.model("Referral", referralSchema);
