const User = require("../models/User");
const MAX_RATE = Number(process.env.MAX_SCORE_RATE) || 300;
const MAX_FLAGS = Number(process.env.MAX_FLAGS_BEFORE_BAN) || 3;
const MAX_GAME_SCORE = 80000;
const CHECK_INTERVAL = 10;

const analyseScore = ({ player, newScore }) => {
  const issues = [];
  if (newScore > MAX_GAME_SCORE) issues.push({ type:"IMPOSSIBLE_SCORE", detail:`Score ${newScore} exceeds max ${MAX_GAME_SCORE}` });
  if (player.lastCheckTime) {
    const timeSince = (Date.now() - new Date(player.lastCheckTime).getTime())/1000;
    if (timeSince >= CHECK_INTERVAL) {
      const delta = newScore - (player.lastScoreCheck||0);
      const rate = delta/timeSince;
      if (rate > MAX_RATE) issues.push({ type:"HIGH_SCORE_RATE", detail:`${rate.toFixed(0)} pts/sec > max ${MAX_RATE}` });
    }
  }
  if (newScore < (player.score||0)) issues.push({ type:"SCORE_DECREASED", detail:`Score dropped from ${player.score} to ${newScore}` });
  return { suspicious: issues.length>0, issues, shouldDisqualify: issues.some(i=>i.type==="IMPOSSIBLE_SCORE"||i.type==="HIGH_SCORE_RATE") };
};

const flagUser = async ({ userId, sessionId, score, reason }) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;
    user.fraudFlags += 1;
    user.fraudHistory.push({ reason, sessionId, score, timestamp:new Date() });
    if (user.fraudFlags >= MAX_FLAGS && !user.isBanned) {
      user.isBanned = true;
      user.banReason = `Auto-banned: ${user.fraudFlags} fraud flags. Last: ${reason}`;
      user.fraudFlagged = true;
      console.warn(`🚨 AUTO-BAN: ${user.name} — ${user.fraudFlags} flags`);
    }
    await user.save();
    return { flagCount:user.fraudFlags, autoBanned:user.isBanned };
  } catch (err) { console.error("flagUser error:", err.message); }
};

const getFraudReport = async () => {
  return User.find({ fraudFlags: { $gt:0 } })
    .select("name email fraudFlags fraudFlagged isBanned fraudHistory createdAt")
    .sort({ fraudFlags:-1 }).limit(50);
};

module.exports = { analyseScore, flagUser, getFraudReport, MAX_RATE, CHECK_INTERVAL };
