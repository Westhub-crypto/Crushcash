const rateLimit = require("express-rate-limit");
const make = (windowMs, max, msg) => rateLimit({
  windowMs, max, standardHeaders:true, legacyHeaders:false,
  message:{ success:false, error:msg },
});
const limiters = {
  global:   make(15*60*1000, 300, "Too many requests. Please slow down."),
  auth:     make(15*60*1000,  10, "Too many auth attempts. Try again in 15 minutes."),
  deposit:  make(60*1000,      5, "Too many deposit requests. Wait 1 minute."),
  withdraw: make(60*1000,      3, "Too many withdrawal requests. Wait 1 minute."),
  gameJoin: make(60*1000,     10, "Too many join attempts. Wait 1 minute."),
  kyc:      make(60*60*1000,   5, "Too many KYC attempts. Try again in 1 hour."),
  referral: make(60*1000,     20, "Too many referral requests."),
  admin:    make(60*1000,     60, "Too many admin requests."),
};
const applyRateLimits = (app) => {
  app.use("/api/", limiters.global);
  app.use("/api/auth/login",    limiters.auth);
  app.use("/api/auth/register", limiters.auth);
  app.use("/api/auth/password", limiters.auth);
  app.use("/api/wallet/deposit",  limiters.deposit);
  app.use("/api/wallet/withdraw", limiters.withdraw);
  app.use("/api/game/join", limiters.gameJoin);
  app.use("/api/kyc", limiters.kyc);
  app.use("/api/referral", limiters.referral);
  app.use("/api/admin", limiters.admin);
};
module.exports = { applyRateLimits, limiters };
                 
