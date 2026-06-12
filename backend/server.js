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
const kycRoutes      = require("./routes/kyc");
const referralRoutes = require("./routes/referral");
const { initGameSocket } = require("./socket/gameSocket");

const app    = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

// ── Socket.io — same origin now, CORS not even needed but kept safe ──
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] },
  pingTimeout: 60000,
});

// ── Force HTTPS in production ────────────────────────────
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// ── Security headers (relaxed CSP so the React build can load) ──
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ── Raw body for SquadCo webhook signature verification ──
app.use("/api/wallet/webhook", express.raw({ type: "application/json" }));

// ── JSON body for everything else ─────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ── Rate limiting ──────────────────────────────────────────
applyRateLimits(app);

// ── API routes ──────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/wallet",   walletRoutes);
app.use("/api/game",     gameRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/kyc",      kycRoutes);
app.use("/api/referral", referralRoutes);

// ── Health check ────────────────────────────────────────────
app.get("/api/health", (req, res) =>
  res.json({ success:true, service:"CrushCash API", status:"online", ts:new Date().toISOString() })
);

// ── Serve the React frontend build ───────────────────────────
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(FRONTEND_DIST));

// Any non-API route → index.html (so React Router / hash routes like #masteradmin work)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

// ── 404 for unmatched API routes ─────────────────────────────
app.use("/api", (req, res) => res.status(404).json({ success:false, error:"Route not found" }));

// ── Global error handler — logs full error to Render logs ───
app.use((err, req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ── Socket.io game engine ─────────────────────────────────────
initGameSocket(io);

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set. Add it in Render → Environment.");
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is not set. Add it in Render → Environment.");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    server.listen(PORT, () => console.log(`🍬 CrushCash running on :${PORT} [${process.env.NODE_ENV}]`));
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("   → Check MONGODB_URI is correct and MongoDB Atlas Network Access allows 0.0.0.0/0");
    process.exit(1);
  });

process.on("SIGTERM", () => {
  console.log("⚠️  SIGTERM — shutting down");
  server.close(() => {
    mongoose.connection.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
});

module.exports = { app, io };
  
