// seasonpass.js
//
// SEASON PASS
//
// DESIGN RULE THE USER SET: passes never expire and are NOT pay-to-win.
// That shapes everything here:
//   - A pass is unlocked with a Season Pass Token, which is winnable
//     in-game (and later purchasable). Once unlocked it's unlocked
//     forever — there is no "season ended, you lost your progress".
//   - Every reward is COSMETIC or a droid. No stat currency, no
//     crystals-per-token, nothing that makes a paying player stronger.
//   - Progress is earned by playing. Tokens buy ACCESS to a track, not
//     the rewards on it.
//
// MULTIPLE TRACKS
// A player can own several passes and choose which one they're working
// on. Progress on the others is kept, so switching costs nothing but
// time.
//
// ADMIN LIFECYCLE
// A season is invisible until an admin turns it on. States:
//   draft      — hidden, tab shows "Coming Soon" greyed out
//   scheduled  — starts at a future date, tab shows a countdown
//   active     — live
//   ended      — no longer joinable, but owned passes still work
//
// The tab greys out entirely when nothing is active or scheduled.

const db = require('./db');

const XP_PER_TIER = 100;
const MAX_TIER = 35; // 35 new items = 35 tiers

// XP is earned from the same actions that drive everything else, so a
// pass rewards playing rather than a separate grind.
const PASS_XP = {
  capture: 2,
  rareCapture: 6,
  hatch: 5,
  evolve: 8,
  battleWin: 8,
  titanWin: 20,
  apexWin: 40,
  forgeSuccess: 12,
  fortCaptured: 60,
  depotVisit: 4,
  dailySpin: 10,
};

class PassError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// seasonId -> season definition
const seasons = new Map();

function makeSeason({ id, name, theme, rewards }) {
  return {
    id,
    name,
    theme: theme || 'default',
    status: 'draft',       // draft | scheduled | active | ended
    startsAt: null,
    endsAt: null,
    rewards,               // [{ tier, type, itemId, name, premium }]
    createdAt: Date.now(),
  };
}


// ---- Season 1 definition ----
// 35 tiers built from the new art: cosmetic pieces, outfits and droids.
// Nothing here is a stat item — see the design rule at the top.
const S1_COSMETIC_SETS = [
  ['fr', 'Frost'], ['nb', 'Nebula'], ['br', 'Breeder'], ['pt', 'Party'],
  ['tn', 'Titan'], ['ax', 'Apex Regalia'], ['gn', 'Genesis'], ['ch', 'Chaos'],
  ['im', 'Imperial'], ['dc', 'Medic'], ['sp', 'Steampunk'], ['cl', 'Carnival'],
];
const PARTS = [['head', 'Helm'], ['body', 'Body'], ['arms', 'Arms'], ['legs', 'Legs']];

const S1_OUTFITS = [
  ['medieval', 'Medieval'], ['droidrepairdoctor', 'Droid Repair Doctor'],
  ['partyanimal', 'Party Animal'], ['pizzacommander', 'Pizza Commander'],
  ['tacticalranger', 'Tactical Ranger'], ['starknight', 'Star Knight'],
  ['candycarnage', 'Candy Carnage'], ['galacticchicken', 'Galactic Chicken'],
  ['angelicwarden', 'Angelic Warden'], ['voidronin', 'Void Ronin'],
  ['dinodrifter', 'Dino Drifter'], ['bananabassist', 'Banana Bassist'],
];

function buildSeasonOne() {
  const rewards = [];
  let tier = 1;
  // Alternate cosmetics and outfits so the track never feels like a
  // long run of the same thing.
  const cosmeticQueue = [];
  S1_COSMETIC_SETS.forEach(([prefix, setName]) => {
    PARTS.forEach(([part, label]) => {
      cosmeticQueue.push({ type: 'cosmetic', itemId: `${prefix}${part}`, name: `${setName} ${label}` });
    });
  });

  const outfitQueue = S1_OUTFITS.map(([id, name]) => ({ type: 'outfit', itemId: id, name }));

  while (tier <= MAX_TIER) {
    // Every 3rd tier is an outfit; the rest are cosmetic pieces.
    let reward;
    if (tier % 3 === 0 && outfitQueue.length) reward = outfitQueue.shift();
    else if (cosmeticQueue.length) reward = cosmeticQueue.shift();
    else if (outfitQueue.length) reward = outfitQueue.shift();
    else break;
    rewards.push({ tier, ...reward, premium: tier % 5 === 0 });
    tier++;
  }
  return makeSeason({ id: 'season1', name: 'Season 1 — Frozen Frontier', theme: 'frost', rewards });
}

seasons.set('season1', buildSeasonOne());

// ---- admin lifecycle ----

function listSeasons() {
  return [...seasons.values()].map((s) => ({
    id: s.id, name: s.name, theme: s.theme, status: effectiveStatus(s),
    startsAt: s.startsAt, endsAt: s.endsAt, tiers: s.rewards.length,
  }));
}

// Status is DERIVED from the clock, not stored — a scheduled season
// flips to active on its own even if the server was asleep when the
// start time passed.
function effectiveStatus(season) {
  if (season.status === 'draft' || season.status === 'ended') return season.status;
  const now = Date.now();
  if (season.startsAt && now < season.startsAt) return 'scheduled';
  if (season.endsAt && now > season.endsAt) return 'ended';
  return 'active';
}

function activateSeason(seasonId, { inDays = 0, durationDays = null } = {}) {
  const season = seasons.get(seasonId);
  if (!season) throw new PassError('NO_SEASON', 'Season not found');
  const now = Date.now();
  season.startsAt = now + Math.max(0, Number(inDays) || 0) * 86400000;
  season.endsAt = durationDays ? season.startsAt + Number(durationDays) * 86400000 : null;
  season.status = 'scheduled';
  return { ...season, status: effectiveStatus(season) };
}

function deactivateSeason(seasonId) {
  const season = seasons.get(seasonId);
  if (!season) throw new PassError('NO_SEASON', 'Season not found');
  season.status = 'draft';
  season.startsAt = null;
  season.endsAt = null;
  return { ...season, status: 'draft' };
}

// The one season players actually see. Scheduled counts, so the tab can
// show a countdown rather than just "coming soon".
function visibleSeason() {
  const live = [...seasons.values()].find((s) => effectiveStatus(s) === 'active');
  if (live) return live;
  const soon = [...seasons.values()]
    .filter((s) => effectiveStatus(s) === 'scheduled')
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  return soon || null;
}

// ---- player progress ----

function progressOf(player) {
  return player.seasonPasses || (player.seasonPasses = {});
}

function passFor(player, seasonId) {
  const all = progressOf(player);
  if (!all[seasonId]) all[seasonId] = { unlocked: false, xp: 0, claimed: [] };
  return all[seasonId];
}

function unlockPass(playerId, seasonId) {
  const player = db.players.get(playerId);
  if (!player) throw new PassError('NO_PLAYER', 'Player not found');
  const season = seasons.get(seasonId);
  if (!season) throw new PassError('NO_SEASON', 'Season not found');
  if (effectiveStatus(season) === 'draft') throw new PassError('NOT_LIVE', 'That season is not available yet');

  const p = passFor(player, seasonId);
  if (p.unlocked) throw new PassError('ALREADY', 'You already own this pass');
  if ((player.seasonTokens || 0) < 1) {
    throw new PassError('NO_TOKEN', 'You need a Season Pass Token to unlock this pass');
  }
  player.seasonTokens -= 1;
  p.unlocked = true;
  p.unlockedAt = Date.now();
  // First pass unlocked becomes the active track automatically.
  if (!player.activeSeasonId) player.activeSeasonId = seasonId;
  return statusFor(playerId);
}

function selectTrack(playerId, seasonId) {
  const player = db.players.get(playerId);
  if (!player) throw new PassError('NO_PLAYER', 'Player not found');
  const p = passFor(player, seasonId);
  if (!p.unlocked) throw new PassError('NOT_OWNED', "You don't own that pass");
  player.activeSeasonId = seasonId;
  return statusFor(playerId);
}

// Called from gameplay. Only the ACTIVE track earns — otherwise every
// pass would fill at once and choosing a track would be meaningless.
function awardXp(playerId, kind, amount = 1) {
  const player = db.players.get(playerId);
  if (!player || !player.activeSeasonId) return null;
  const season = seasons.get(player.activeSeasonId);
  if (!season || effectiveStatus(season) !== 'active') return null;
  const p = passFor(player, player.activeSeasonId);
  if (!p.unlocked) return null;
  const pts = (PASS_XP[kind] || 0) * amount;
  if (!pts) return null;
  p.xp += pts;
  return pts;
}

function tierFor(xp) {
  return Math.min(MAX_TIER, Math.floor(xp / XP_PER_TIER));
}

function claimTier(playerId, seasonId, tier) {
  const player = db.players.get(playerId);
  if (!player) throw new PassError('NO_PLAYER', 'Player not found');
  const season = seasons.get(seasonId);
  if (!season) throw new PassError('NO_SEASON', 'Season not found');
  const p = passFor(player, seasonId);
  if (!p.unlocked) throw new PassError('NOT_OWNED', "You don't own that pass");
  const t = Number(tier);
  if (tierFor(p.xp) < t) throw new PassError('NOT_REACHED', `You haven't reached tier ${t} yet`);
  if (p.claimed.includes(t)) throw new PassError('ALREADY_CLAIMED', 'Already claimed');

  const reward = season.rewards.find((r) => r.tier === t);
  if (!reward) throw new PassError('NO_REWARD', 'No reward at that tier');

  grantReward(player, reward);
  p.claimed.push(t);
  return { reward, ...statusFor(playerId) };
}

// Rewards go STRAIGHT to the player, per the spec.
function grantReward(player, reward) {
  if (reward.type === 'outfit') {
    player.ownedOutfits = player.ownedOutfits || ['basic'];
    if (!player.ownedOutfits.includes(reward.itemId)) player.ownedOutfits.push(reward.itemId);
  } else if (reward.type === 'cosmetic') {
    player.ownedCosmeticPieces = player.ownedCosmeticPieces || [];
    if (!player.ownedCosmeticPieces.includes(reward.itemId)) player.ownedCosmeticPieces.push(reward.itemId);
  } else if (reward.type === 'droid') {
    const species = db.droidSpecies.find((s) => s.name === reward.itemId || s.id === reward.itemId);
    if (species) {
      const d = {
        id: db.nextId(), playerId: player.id, speciesId: species.id,
        variant: 'standard', level: 1, captureCost: 0, capturedAt: Date.now(),
        workshopSlotId: null, currentHpDamage: 0, hiddenFromTrade: false,
        fromSeasonPass: true,
      };
      db.ownedDroids.set(d.id, d);
      db.markDexSeen(player.id, species.id, 'standard');
    }
  } else if (reward.type === 'token') {
    player[reward.itemId] = (player[reward.itemId] || 0) + (reward.amount || 1);
  }
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new PassError('NO_PLAYER', 'Player not found');
  const season = visibleSeason();
  const all = progressOf(player);

  const owned = [...seasons.values()]
    .filter((s) => all[s.id] && all[s.id].unlocked)
    .map((s) => ({
      id: s.id, name: s.name, theme: s.theme,
      status: effectiveStatus(s),
      xp: all[s.id].xp,
      tier: tierFor(all[s.id].xp),
      active: player.activeSeasonId === s.id,
    }));

  if (!season) {
    return {
      // Nothing live and nothing scheduled — the tab greys out.
      available: false,
      comingSoon: true,
      season: null,
      ownedPasses: owned,
      seasonTokens: player.seasonTokens || 0,
    };
  }

  const status = effectiveStatus(season);
  const p = passFor(player, season.id);
  const tier = tierFor(p.xp);

  return {
    available: status === 'active',
    comingSoon: status === 'scheduled',
    startsAt: season.startsAt,
    msUntilStart: season.startsAt ? Math.max(0, season.startsAt - Date.now()) : 0,
    endsAt: season.endsAt,
    season: {
      id: season.id, name: season.name, theme: season.theme, status,
      maxTier: MAX_TIER, xpPerTier: XP_PER_TIER,
      rewards: season.rewards.map((r) => ({
        ...r,
        unlocked: tier >= r.tier,
        claimed: p.claimed.includes(r.tier),
      })),
    },
    unlocked: p.unlocked,
    xp: p.xp,
    tier,
    xpIntoTier: p.xp % XP_PER_TIER,
    isActiveTrack: player.activeSeasonId === season.id,
    ownedPasses: owned,
    seasonTokens: player.seasonTokens || 0,
    claimable: season.rewards.filter((r) => tier >= r.tier && !p.claimed.includes(r.tier)).length,
  };
}

// ---- persistence ----
function exportSeasons() {
  return [...seasons.values()];
}
function importSeasons(rows) {
  if (!rows || !rows.length) return; // keep the built-in definitions
  seasons.clear();
  rows.forEach((s) => seasons.set(s.id, s));
}

module.exports = {
  seasons, makeSeason,
  XP_PER_TIER, MAX_TIER, PASS_XP,
  listSeasons, activateSeason, deactivateSeason, visibleSeason, effectiveStatus,
  unlockPass, selectTrack, awardXp, claimTier, statusFor, tierFor,
  exportSeasons, importSeasons,
  PassError,
};
