const mongoose = require("mongoose");
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  type: { type:String, enum:["deposit","withdrawal","game_entry","game_win","refund","bonus","referral_reward"], required:true },
  amount: { type:Number, required:true, min:0 },
  description: { type:String, required:true },
  status: { type:String, enum:["pending","completed","failed","processing"], default:"pending" },
  reference: { type:String, unique:true, sparse:true },
  squadcoRef: { type:String },
  gameSessionId: { type: mongoose.Schema.Types.ObjectId, ref:"GameSession" },
  roomId: { type:Number },
  balanceBefore: { type:Number },
  balanceAfter: { type:Number },
  metadata: { type:Object, default:{} },
  createdAt: { type:Date, default:Date.now },
  completedAt: { type:Date },
});
transactionSchema.index({ userId:1, createdAt:-1 });
transactionSchema.index({ reference:1 });
module.exports = mongoose.model("Transaction", transactionSchema);
