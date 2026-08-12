// ranked.js
//
// RANKED ARENA — competitive 1v1 with a rating, divisions and seasons.
//
// WHY THIS, AND WHY NOW
// Live PVP already works, but a win is worth 500 crystals and nothing
// else. There is no reason to play your hundredth match, and a solo
// player has no long-term goal at all — the weekly ladder rewards
// guilds. This gives individual play a chase that never finishes.
//
// THE THREE DESIGN RULES
//
// 1. LOSING NEVER UNDOES A DIVISION YOU EARNED.
//    Each division has a rating FLOOR. Once you reach Gold you cannot
//    fall below Gold's floor, whatever happens. Ladders that let you
//    tumble backwards punish playing — people stop queuing to protect
//    a number. This makes climbing monotonic and queuing safe.
//
// 2. REWARDS ARE PAID ON PEAK, NOT FINAL.
//    Season rewards use the HIGHEST division you touched, so a bad run
//    on the last evening can't cost you what you already achieved.
//
// 3. RATING IS EARNED FROM OPPONENTS, NOT VOLUME.
//    Elo means beating someone above you is worth far more than farming
//    someone below. Grinding weak opponents converges to nothing, so
//    the ladder measures skill rather than free time.

const db = require('./db');

const START_RATING = 1000;
const K_BASE = 32;          // rating swing for an established player
const K_PLACEMENT = 64;     // faster movement while placing
const PLACEMENT_MATCHES = 5;

// Divisions. `floor` is the protected rating — you can never drop
// below the floor of the highest division you've reached.
// floor === min on purpose. A floor set BELOW the division's minimum
// would let a "protected" Gold player sit at a Silver rating, which
// makes the promise a lie. Reaching a division means staying in it.
const DIVISIONS = [
  { id: 'bronze',      name: 'Bronze',      min: 0,    floor: 0,    icon: '🥉', colour: '#b0713a' },
  { id: 'silver',      name: 'Silver',      min: 1100, floor: 1100, icon: '🥈', colour: '#b9c4cc' },
  { id: 'gold',        name: 'Gold',        min: 1250, floor: 1250, icon: '🥇', colour: '#e8c14f' },
  { id: 'platinum',    name: 'Platinum',    min: 1400, floor: 1400, icon: '💎', colour: '#5fd8e0' },
  { id: 'diamond',     name: 'Diamond',     min: 1550, floor: 1550, icon: '💠', colour: '#4cb8e8' },
  { id: 'master',      name: 'Master',      min: 1700, floor: 1700, icon: '👑', colour: '#8b6de0' },
  { id: 'grandmaster', name: 'Grandmaster', min: 1900, floor: 1900, icon: '🌟', colour: '#ff2d3f' },
];

// Paid at season end, by PEAK division reached.
const SEASON_REWARDS = {
  bronze:      { crystals: 5000,   seasonTokens: 0, guildTokens: 0,  title: 'Contender' },
  silver:      { crystals: 15000,  seasonTokens: 0, guildTokens: 2,  title: 'Challenger' },
  gold:        { crystals: 40000,  seasonTokens: 1, guildTokens: 5,  title: 'Duellist' },
  platinum:    { crystals: 90000,  seasonTokens: 1, guildTokens: 10, title: 'Vanguard' },
  diamond:     { crystals: 175000, seasonTokens: 2, guildTokens: 18, title: 'Ascendant' },
  master:      { crystals: 320000, seasonTokens: 2, guildTokens: 30, title: 'Warlord' },
  grandmaster: { crystals: 600000, seasonTokens: 3, guildTokens: 50, title: 'Rift Sovereign' },
};

// Per-win crystals scale with division, so climbing pays immediately
// rather than only at season end.
const WIN_CRYSTALS = {
  bronze: 750, silver: 1200, gold: 2000, platinum: 3200,
  diamond: 5000, master: 8000, grandmaster: 12000,
};

class RankedError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function divisionFor(rating) {
  let d = DIVISIONS[0];
  for (const div of DIVISIONS) if (rating >= div.min) d = div;
  return d;
}

function seasonKey(date = new Date()) {
  // Monthly seasons — long enough to climb, short enough that a bad
  // month isn't a lost year.
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function profileOf(player) {
  if (!player.ranked) {
    player.ranked = {
      rating: START_RATING,
      peakRating: START_RATING,
      peakDivision: 'bronze',
      wins: 0, losses: 0, streak: 0, bestStreak: 0,
      placementsLeft: PLACEMENT_MATCHES,
      season: seasonKey(),
      claimedSeasons: [],
      history: [],
    };
  }
  // Season rollover, computed from the clock so a sleeping server
  // catches up the moment anyone looks.
  const nowKey = seasonKey();
  if (player.ranked.season !== nowKey) {
    const prev = player.ranked.season;
    const peak = player.ranked.peakDivision;
    player.ranked.lastSeason = {
      season: prev,
      peakDivision: peak,
      rating: player.ranked.rating,
      wins: player.ranked.wins,
      losses: player.ranked.losses,
      claimed: false,
    };
    // Soft reset: pulled toward the middle, never below your protected
    // floor. A full reset would make every season start identically and
    // erase what people earned.
    const floor = protectedFloor(peak);
    player.ranked.rating = Math.max(floor, Math.round(START_RATING + (player.ranked.rating - START_RATING) * 0.5));
    player.ranked.peakRating = player.ranked.rating;
    player.ranked.peakDivision = divisionFor(player.ranked.rating).id;
    player.ranked.wins = 0;
    player.ranked.losses = 0;
    player.ranked.streak = 0;
    player.ranked.placementsLeft = 3; // shorter re-placement after season one
    player.ranked.season = nowKey;
  }
  return player.ranked;
}

function protectedFloor(peakDivisionId) {
  const d = DIVISIONS.find((x) => x.id === peakDivisionId);
  return d ? d.floor : 0;
}

function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

// Called by livepvp when a ranked match ends.
function recordResult(winnerId, loserId) {
  const winner = db.players.get(winnerId);
  const loser = db.players.get(loserId);
  if (!winner || !loser) return null;

  const w = profileOf(winner);
  const l = profileOf(loser);
  const wBefore = w.rating;
  const lBefore = l.rating;

  const kW = w.placementsLeft > 0 ? K_PLACEMENT : K_BASE;
  const kL = l.placementsLeft > 0 ? K_PLACEMENT : K_BASE;

  const expW = expectedScore(wBefore, lBefore);
  const expL = expectedScore(lBefore, wBefore);

  // Streak bonus, capped AND scaled by how real the win was. A flat
  // bonus was measured letting a player farm one weak opponent 40 times
  // to Platinum: Elo correctly gave ~0 per win, but the flat +8 kept
  // paying. Multiplying by (1 - expW) makes the bonus vanish exactly as
  // the match becomes a formality.
  const streakBonus = Math.round(Math.min(8, Math.max(0, w.streak - 2) * 2) * (1 - expW));

  w.rating = Math.round(wBefore + kW * (1 - expW)) + streakBonus;
  l.rating = Math.round(lBefore + kL * (0 - expL));

  // Rule 1: the floor of your peak division protects you.
  l.rating = Math.max(protectedFloor(l.peakDivision), l.rating);

  w.wins++; w.streak++; w.bestStreak = Math.max(w.bestStreak, w.streak);
  l.losses++; l.streak = 0;
  if (w.placementsLeft > 0) w.placementsLeft--;
  if (l.placementsLeft > 0) l.placementsLeft--;

  if (w.rating > w.peakRating) {
    w.peakRating = w.rating;
    const d = divisionFor(w.rating);
    const prevIndex = DIVISIONS.findIndex((x) => x.id === w.peakDivision);
    const newIndex = DIVISIONS.findIndex((x) => x.id === d.id);
    if (newIndex > prevIndex) w.peakDivision = d.id;
  }

  const div = divisionFor(w.rating);
  const payout = WIN_CRYSTALS[div.id] || 750;
  winner.crystalBalance = (winner.crystalBalance || 0) + payout;
  db.crystalTransactions.push({
    id: db.nextId(), playerId: winnerId, amount: payout, source: 'ranked_win', createdAt: Date.now(),
  });

  const entry = (opponent, before, after, won) => ({
    at: Date.now(), opponent, before, after, delta: after - before, won,
  });
  w.history.unshift(entry(loser.username, wBefore, w.rating, true));
  l.history.unshift(entry(winner.username, lBefore, l.rating, false));
  if (w.history.length > 20) w.history.length = 20;
  if (l.history.length > 20) l.history.length = 20;

  return {
    winner: { id: winnerId, before: wBefore, after: w.rating, delta: w.rating - wBefore, division: divisionFor(w.rating), payout, streak: w.streak },
    loser: { id: loserId, before: lBefore, after: l.rating, delta: l.rating - lBefore, division: divisionFor(l.rating), floored: l.rating === protectedFloor(l.peakDivision) },
  };
}

function claimSeasonReward(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RankedError('NO_PLAYER', 'Player not found');
  const p = profileOf(player);
  const last = p.lastSeason;
  if (!last) throw new RankedError('NOTHING', 'You have no finished season to claim');
  if (last.claimed) throw new RankedError('CLAIMED', "You've already claimed that season");

  const reward = SEASON_REWARDS[last.peakDivision] || SEASON_REWARDS.bronze;
  player.crystalBalance = (player.crystalBalance || 0) + reward.crystals;
  db.crystalTransactions.push({
    id: db.nextId(), playerId, amount: reward.crystals, source: 'ranked_season', createdAt: Date.now(),
  });
  if (reward.seasonTokens) player.seasonTokens = (player.seasonTokens || 0) + reward.seasonTokens;
  if (reward.guildTokens) player.guildTokens = (player.guildTokens || 0) + reward.guildTokens;

  last.claimed = true;
  p.claimedSeasons.push(last.season);
  // The title is permanent — a trophy from a season that already ended
  // is the clearest sign that time spent isn't erased.
  player.rankedTitles = player.rankedTitles || [];
  if (!player.rankedTitles.includes(reward.title)) player.rankedTitles.push(reward.title);

  return { reward, season: last.season, peakDivision: last.peakDivision, titles: player.rankedTitles };
}

// Titles are earned permanently but only one shows at a time — a wall
// of every title you've ever won would say less than one chosen one.
function equipTitle(playerId, title) {
  const player = db.players.get(playerId);
  if (!player) throw new RankedError('NO_PLAYER', 'Player not found');
  if (title === null || title === '') { player.equippedTitle = null; return { equippedTitle: null }; }
  if (!(player.rankedTitles || []).includes(title)) {
    throw new RankedError('NOT_EARNED', "You haven't earned that title");
  }
  player.equippedTitle = title;
  return { equippedTitle: title };
}

function leaderboard(limit = 25) {
  return [...db.players.values()]
    .filter((p) => p.ranked && (p.ranked.wins + p.ranked.losses) > 0)
    .map((p) => {
      const r = p.ranked;
      const d = divisionFor(r.rating);
      return {
        playerId: p.id,
        username: p.username,
        rating: r.rating,
        division: d.id,
        divisionName: d.name,
        icon: d.icon,
        wins: r.wins,
        losses: r.losses,
        winRate: r.wins + r.losses ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0,
        title: p.equippedTitle || null,
        badgeIcon: p.playerBadgeIcon || null,
        badgeFolder: p.playerBadgeFolder || null,
      };
    })
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RankedError('NO_PLAYER', 'Player not found');
  const p = profileOf(player);
  const div = divisionFor(p.rating);
  const idx = DIVISIONS.findIndex((d) => d.id === div.id);
  const next = DIVISIONS[idx + 1] || null;
  const board = leaderboard(25);
  const mine = board.find((r) => r.playerId === playerId);

  return {
    rating: p.rating,
    peakRating: p.peakRating,
    division: { ...div, index: idx },
    peakDivision: p.peakDivision,
    protectedFloor: protectedFloor(p.peakDivision),
    nextDivision: next ? { ...next, pointsAway: next.min - p.rating } : null,
    progressToNext: next
      ? Math.max(0, Math.min(100, Math.round(((p.rating - div.min) / (next.min - div.min)) * 100)))
      : 100,
    wins: p.wins,
    losses: p.losses,
    streak: p.streak,
    bestStreak: p.bestStreak,
    placementsLeft: p.placementsLeft,
    inPlacement: p.placementsLeft > 0,
    season: p.season,
    seasonEndsAt: seasonEndsAt(),
    winReward: WIN_CRYSTALS[div.id],
    divisions: DIVISIONS.map((d) => ({ ...d, reward: SEASON_REWARDS[d.id] })),
    history: p.history.slice(0, 10),
    leaderboard: board,
    myRank: mine ? mine.rank : null,
    titles: player.rankedTitles || [],
    equippedTitle: player.equippedTitle || null,
    lastSeason: p.lastSeason && !p.lastSeason.claimed
      ? { ...p.lastSeason, reward: SEASON_REWARDS[p.lastSeason.peakDivision] }
      : null,
  };
}

function seasonEndsAt() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0);
}

module.exports = {
  DIVISIONS, SEASON_REWARDS, WIN_CRYSTALS, START_RATING, PLACEMENT_MATCHES,
  divisionFor, protectedFloor, expectedScore,
  recordResult, claimSeasonReward, leaderboard, equipTitle, statusFor, profileOf, seasonKey,
  RankedError,
};
