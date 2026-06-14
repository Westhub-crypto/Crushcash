require("dotenv").config();
const express    = require("express");
const path       = require("path");
const http       = require("http");
const { Server } = require("socket.io");
const mongoose   = require("mongoose");
const helmet     = require("helmet");
const { applyRateLimits } = require("./middleware/rateLimits");

const authRoutes     = require("./routes/auth");
const walletRoutes   = require("./routes/wallet");
const gameRoutes     = require("./routes/game");
const adminRoutes    = require("./routes/admin");
const profileRoutes  = require("./routes/profile");
const referralRoutes = require("./routes/referral");
const { initGameSocket } = require("./socket/gameSocket");

const app    = express();
const server = http.createServer(app);

// Required for Render's reverse proxy — fixes express-rate-limit on every request
app.set("trust proxy", 1);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] },
  pingTimeout: 60000,
});

app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] !== "https")
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  next();
});

app.use(helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false }));
app.use("/api/wallet/webhook", express.raw({ type:"application/json" }));
app.use(express.json({ limit:"10kb" }));
app.use(express.urlencoded({ extended:true, limit:"10kb" }));

applyRateLimits(app);

app.use("/api/auth",     authRoutes);
app.use("/api/wallet",   walletRoutes);
app.use("/api/game",     gameRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/profile",  profileRoutes);
app.use("/api/referral", referralRoutes);

app.get("/api/health", (req, res) =>
  res.json({ success:true, service:"CrushCash", status:"online", ts:new Date().toISOString() })
);

// Serve React frontend
const FRONTEND = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(FRONTEND));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(FRONTEND, "index.html")));
app.use("/api", (req, res) => res.status(404).json({ success:false, error:"Not found" }));

app.use((err, req, res, _next) => {
  console.error("❌ Server error:", err.message);
  res.status(err.statusCode || 500).json({
    success: false,
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

initGameSocket(io);

const PORT = process.env.PORT || 10000;

if (!process.env.MONGODB_URI) { console.error("❌ MONGODB_URI not set"); process.exit(1); }
if (!process.env.JWT_SECRET)  { console.error("❌ JWT_SECRET not set");  process.exit(1); }

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");

    // ── AUTO-FIX: drop legacy username_1 index that causes duplicate key errors ──
    // This index was left over from an old schema version and blocks all new registrations
    // after the first user. Safe to drop — User model has no username field.
    try {
      const User = require("./models/User");
      await User.collection.dropIndex("username_1");
      console.log("🧹 Dropped legacy username_1 index — registration now works for all users");
    } catch (e) {
      if (e.codeName !== "IndexNotFound" && e.code !== 27) {
        console.warn("⚠️  Could not drop username_1 index:", e.message);
      }
      // Index not found means it was already dropped — that's fine
    }

    server.listen(PORT, () =>
      console.log(`🍬 CrushCash running on :${PORT} [${process.env.NODE_ENV}]`)
    );
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });

process.on("SIGTERM", () => {
  server.close(() => {
    mongoose.connection.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
});

module.exports = { app, io };
  
