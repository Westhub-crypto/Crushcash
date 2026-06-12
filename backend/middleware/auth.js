const jwt  = require("jsonwebtoken");
const User = require("../models/User");
const protect = async (req, res, next) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer "))
      return res.status(401).json({ success:false, error:"No token. Please log in." });
    const decoded = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ success:false, error:"User not found." });
    if (user.isBanned) return res.status(403).json({ success:false, error:"Account suspended." });
    req.user = user;
    next();
  } catch (e) {
    const msg = e.name === "TokenExpiredError" ? "Token expired." : "Invalid token.";
    res.status(401).json({ success:false, error:msg });
  }
};
const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ success:false, error:"Admin access required." });
  next();
};
module.exports = { protect, adminOnly };
