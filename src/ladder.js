// ladder.js
//
// WEEKLY GUILD LADDER
//
// WHY THIS EXISTS
// Everything else in the game is either solo or admin-triggered. The
// Forge, Fort economy and Guild Tokens had no engine of their own —
// tokens only arrived from Fort payouts, so a guild without territory
// had no route in at all. The ladder gives guild play a rhythm that
// doesn't depend on anyone pressing an admin button.
//
// HOW SCORING WORKS
// Points accrue as members play. Weighted so that the hard, coordinated
// things are worth more than the grindable ones — otherwise the winner
// is whoever tapped capture most, which rewards tedium.
//
// THE WEEK BOUNDARY
// Weeks are ISO weeks in UTC, derived from the clock rather than
// scheduled. Render sleeps, so a cron-style rollover would silently skip
// weeks; computing the current week key on read means a sleeping server
// catches up the moment anyone touches it.

const db = require('./db');

const POINTS = {
  capture: 1,
  rareCapture: 5,        // rare or above
  apexCapture: 50,
  hatch: 3,
  evolve: 5,
  battleWin: 5,
  titanWin: 25,
  apexWin: 60,
  livePvpWin: 10,
  fortCaptured: 250,     // taking a rival Fort
  fortHeld: 40,          // per Fort still held at rollover
  forgeSuccess: 15,
};

// Paid to EVERY member of the guild, so a big guild doesn't out-earn a
// small one per head — the prize is per player, the rank is collective.
const PRIZES = [
  { rank: 1, guildTokens: 25, crystals: 50000 },
  { rank: 2, guildTokens: 15, crystals: 30000 },
  { rank: 3, guildTokens: 10, crystals: 20000 },
  { rank: 5, guildTokens: 5, crystals: 10000 },   // ranks 4-5
  { rank: 10, guildTokens: 2, crystals: 5000 },   // ranks 6-10
];

// guildId -> { weekKey -> points }
const scores = new Map();
// weekKey -> [{ guildId, guildName, points, rank }]
const history = new Map();
const claimed = new Map(); // `${weekKey}:${playerId}` -> true

function weekKeyFor(date = new Date()) {
  // ISO week: Thursday of the current week decides the year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function previousWeekKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return weekKeyFor(d);
}

function guildScores(guildId) {
  if (!scores.has(guildId)) scores.set(guildId, {});
  return scores.get(guildId);
}

// The single entry point. Everything else in the codebase calls this.
function award(playerId, kind, amount = 1) {
  const player = db.players.get(playerId);
  if (!player || !player.guildId) return null; // guildless play doesn't score
  const pts = (POINTS[kind] || 0) * amount;
  if (!pts) return null;
  const wk = weekKeyFor();
  const g = guildScores(player.guildId);
  g[wk] = (g[wk] || 0) + pts;
  return pts;
}

function standingsFor(weekKey = weekKeyFor()) {
  const rows = [];
  for (const [guildId, weeks] of scores.entries()) {
    const points = weeks[weekKey] || 0;
    if (!points) continue;
    const guild = db.guilds.get(guildId);
    rows.push({
      guildId,
      guildName: guild ? guild.name : 'Disbanded guild',
      memberCount: guild ? guild.memberIds.length : 0,
      points,
    });
  }
  rows.sort((a, b) => b.points - a.points);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function prizeForRank(rank) {
  for (const p of PRIZES) {
    if (rank <= p.rank) return p;
  }
  return null;
}

// Called lazily: the first time anyone looks at the ladder in a new
// week, last week's table is frozen into history so prizes can be
// claimed against a fixed result rather than a moving one.
function ensureRollover() {
  const prev = previousWeekKey();
  if (history.has(prev)) return;
  const rows = standingsFor(prev);
  if (rows.length) history.set(prev, rows);
}

function ladderFor(playerId) {
  ensureRollover();
  const player = db.players.get(playerId);
  const wk = weekKeyFor();
  const rows = standingsFor(wk);
  const myGuildId = player ? player.guildId : null;
  const mine = rows.find((r) => r.guildId === myGuildId) || null;

  const prev = previousWeekKey();
  const lastWeek = history.get(prev) || [];
  const myLast = lastWeek.find((r) => r.guildId === myGuildId) || null;
  const claimKey = `${prev}:${playerId}`;
  const prize = myLast ? prizeForRank(myLast.rank) : null;

  return {
    weekKey: wk,
    endsAt: weekEndsAt(),
    standings: rows.slice(0, 25),
    myGuild: mine,
    hasGuild: Boolean(myGuildId),
    points: POINTS,
    prizes: PRIZES,
    lastWeek: {
      weekKey: prev,
      standings: lastWeek.slice(0, 10),
      myRank: myLast ? myLast.rank : null,
      prize: prize || null,
      claimable: Boolean(prize) && !claimed.has(claimKey),
      claimed: claimed.has(claimKey),
    },
  };
}

function weekEndsAt() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  const daysLeft = 7 - day;
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysLeft, 23, 59, 59));
  return end.getTime();
}

function claimPrize(playerId) {
  ensureRollover();
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!player.guildId) throw new Error('You are not in a guild');
  const prev = previousWeekKey();
  const rows = history.get(prev) || [];
  const row = rows.find((r) => r.guildId === player.guildId);
  if (!row) throw new Error("Your guild didn't place on last week's ladder");
  const prize = prizeForRank(row.rank);
  if (!prize) throw new Error('Your guild finished outside the prize places');
  const key = `${prev}:${playerId}`;
  if (claimed.has(key)) throw new Error("You've already claimed last week's prize");

  claimed.set(key, true);
  player.guildTokens = (player.guildTokens || 0) + prize.guildTokens;
  player.crystalBalance = (player.crystalBalance || 0) + prize.crystals;
  db.crystalTransactions.push({
    id: db.nextId(), playerId, amount: prize.crystals, source: 'ladder_prize', createdAt: Date.now(),
  });
  return { rank: row.rank, weekKey: prev, ...prize, guildTokens: player.guildTokens };
}

// Fort-holding points are awarded at rollover rather than continuously,
// so holding is rewarded but not farmable by re-checking.
function awardFortHolding() {
  try {
    const forts = require('./forts');
    const wk = weekKeyFor();
    const seen = new Set();
    for (const fort of forts.forts.values()) {
      const k = `${wk}:${fort.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const g = guildScores(fort.guildId);
      g[wk] = (g[wk] || 0) + POINTS.fortHeld;
    }
  } catch (e) {}
}

function exportLadder() {
  return {
    scores: [...scores.entries()].map(([guildId, weeks]) => ({ guildId, weeks })),
    history: [...history.entries()].map(([weekKey, rows]) => ({ weekKey, rows })),
    claimed: [...claimed.keys()],
  };
}
function importLadder(state) {
  scores.clear(); history.clear(); claimed.clear();
  if (!state) return;
  (state.scores || []).forEach((r) => scores.set(r.guildId, r.weeks || {}));
  (state.history || []).forEach((r) => history.set(r.weekKey, r.rows || []));
  (state.claimed || []).forEach((k) => claimed.set(k, true));
}

module.exports = {
  POINTS, PRIZES,
  award, ladderFor, standingsFor, claimPrize,
  weekKeyFor, previousWeekKey, weekEndsAt,
  awardFortHolding, ensureRollover,
  exportLadder, importLadder,
  scores, history,
};
