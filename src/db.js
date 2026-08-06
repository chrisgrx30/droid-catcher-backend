// db.js
//
// In-memory data store standing in for Postgres + Redis so this whole
// backend is runnable with zero external dependencies or network access.
// Table shapes below mirror the schema we designed:
//   droid_species, players, owned_droids, workshop_slots,
//   spawns, capture_attempts, crystal_transactions
//
// In production: droid_species/players/owned_droids/workshop_slots/
// capture_attempts/crystal_transactions -> Postgres.
// spawns -> Redis (with native key TTL for auto-expiry).

let nextId = 1;
const id = () => nextId++;

// ---- droid_species (design-time data) ----
// Four per rarity tier now (2 light, 2 dark) across two themed sets — see
// concept-sheet-v1.md for the Mythical set, Nature/Corrupted Nature added
// per later design notes. Per-tier spawn weight is split evenly across all
// species in that tier so overall rarity odds stay at the original design
// (common 60 / uncommon 25 / rare 12 / legendary 3) regardless of how many
// species share the tier.
const droidSpecies = [
  // -- common (60 total / 4 species = 15 each) --
  { id: id(), name: 'Puffkin',    alignment: 'light', rarity: 'common',    collection: 'mythical', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 15 },
  { id: id(), name: 'Gloomrat',   alignment: 'dark',  rarity: 'common',    collection: 'mythical', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 15 },
  { id: id(), name: 'Leafkin',    alignment: 'light', rarity: 'common',    collection: 'nature',   baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 15 },
  { id: id(), name: 'Thornstalk', alignment: 'dark',  rarity: 'common',    collection: 'nature',   baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 15 },

  // -- uncommon (25 total / 4 species = 6.25 each) --
  { id: id(), name: 'Emberfox',   alignment: 'light', rarity: 'uncommon',  collection: 'mythical', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 6.25 },
  { id: id(), name: 'Nightfang',  alignment: 'dark',  rarity: 'uncommon',  collection: 'mythical', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 6.25 },
  { id: id(), name: 'Bloombot',   alignment: 'light', rarity: 'uncommon',  collection: 'nature',   baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 6.25 },
  { id: id(), name: 'Sporecap',   alignment: 'dark',  rarity: 'uncommon',  collection: 'nature',   baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 6.25 },

  // -- rare (12 total / 4 species = 3 each) --
  { id: id(), name: 'Skylantern', alignment: 'light', rarity: 'rare',      collection: 'mythical', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 3 },
  { id: id(), name: 'Ravencowl',  alignment: 'dark',  rarity: 'rare',      collection: 'mythical', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 3 },
  { id: id(), name: 'Vineweave',  alignment: 'light', rarity: 'rare',      collection: 'nature',   baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 3 },
  { id: id(), name: 'Wiltroot',   alignment: 'dark',  rarity: 'rare',      collection: 'nature',   baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 3 },

  // -- legendary (3 total / 4 species = 0.75 each) --
  { id: id(), name: 'Aurumwing',  alignment: 'light', rarity: 'legendary', collection: 'mythical', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.75 },
  { id: id(), name: 'Voidforge',  alignment: 'dark',  rarity: 'legendary', collection: 'mythical', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.75 },
  { id: id(), name: 'Elderwood',  alignment: 'light', rarity: 'legendary', collection: 'nature',   baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.75 },
  { id: id(), name: 'Voidtree',   alignment: 'dark',  rarity: 'legendary', collection: 'nature',   baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.75 },
];

const RARITY_TTL_MS = {
  common: 15 * 60 * 1000,
  uncommon: 10 * 60 * 1000,
  rare: 8 * 60 * 1000,
  legendary: 5 * 60 * 1000,
};

const RARITY_MAX_PER_CELL = {
  common: 3,
  uncommon: 2,
  rare: 1,
  legendary: 1,
};

const LEGENDARY_CITY_CAP = 3;

// ---- crystal power requirement ----
// The control pad literally needs crystals to function (per the original
// pitch) — below this, an attempt is rejected outright rather than just
// having low odds. Scales with rarity: tougher droids need more power.
const MIN_CRYSTAL_COST = {
  common: 1,
  uncommon: 5,
  rare: 15,
  legendary: 40,
};

// ---- variants (shiny-equivalent) ----
// Rolled independently of species/rarity — any droid, even a Common one, can
// come up Platinum or Rusty. Keeps every spawn worth a second look, not just
// the already-rare ones.
//
// TESTING_HIGH_VARIANT_ODDS: flip to false before launch. True makes variants
// common (80% combined) purely so you can visually confirm both render
// correctly without grinding for a 1-in-1000 chance.
const TESTING_HIGH_VARIANT_ODDS = true; // <-- REVERT TO false BEFORE LAUNCH

const VARIANT_ODDS_PRODUCTION = {
  platinum: 1 / 1000,
  rusty: 1 / 1000,
};
const VARIANT_ODDS_TESTING = {
  platinum: 0.10,
  rusty: 0.10,
};
const VARIANT_ODDS = TESTING_HIGH_VARIANT_ODDS ? VARIANT_ODDS_TESTING : VARIANT_ODDS_PRODUCTION;

const VARIANT_CRYSTAL_MULTIPLIER = {
  standard: 1.0,
  platinum: 1.5,
  rusty: 1.0, // deliberately no bonus — Rusty's value is purely cosmetic/collection
};

function rollVariant() {
  const roll = Math.random();
  if (roll < VARIANT_ODDS.platinum) return 'platinum';
  if (roll < VARIANT_ODDS.platinum + VARIANT_ODDS.rusty) return 'rusty';
  return 'standard';
}

// ---- workshop slot unlock cost ----
// Slot 0 is free (granted at signup, holds the starter droid). Every
// additional slot costs 50 more crystals than the last: slot1=50,
// slot2=100, slot3=150 ... slot9=450.
function slotUnlockCost(slotIndex) {
  return 50 * slotIndex;
}

// ---- droid leveling (crystals -> stronger individual droid) ----
// Effect lives in workshop.js's levelMultiplier (+15% crystal rate/level,
// already existed) — this is just the crystal cost to buy the next level.
const DROID_LEVEL_CAP = 20;
function levelUpCost(currentLevel) {
  return Math.round(10 * Math.pow(currentLevel, 1.6));
}

// ---- pad upgrades (crystals -> account-wide capture power) ----
// Separate progression track from droid leveling: this upgrades the
// control pad itself, not any one droid. Two effects: a small chance per
// attempt of a guaranteed "critical capture", and a slightly higher
// ceiling on the accuracy-skill multiplier.
const PAD_CRIT_BASE = 0.02;       // 2% crit chance at pad level 0
const PAD_CRIT_PER_LEVEL = 0.01;  // +1% per level
const PAD_CRIT_CAP = 0.50;        // never exceeds 50% — keep crystal power meaningful
const PAD_SKILL_CEILING_PER_LEVEL = 0.01; // padSkillMultiplier ceiling nudges up slightly per level
function padUpgradeCost(currentPadLevel) {
  return Math.round(100 * Math.pow(currentPadLevel + 1, 1.7));
}
function critChanceForPadLevel(padLevel) {
  return Math.min(PAD_CRIT_CAP, PAD_CRIT_BASE + PAD_CRIT_PER_LEVEL * padLevel);
}

// ---- time-exclusive events ----
// An event boosts spawn weight for a set of species (or a whole
// collection) for a fixed time window. Generalizes the same multiplier
// pattern the day/night alignment bias already uses in spawns.js.
const events = new Map(); // id -> event row

function createEvent({ name, speciesIds = [], collection = null, spawnWeightMultiplier = 2, startTime, endTime }) {
  const event = {
    id: id(),
    name,
    speciesIds,   // explicit species targets, OR
    collection,   // 'mythical' | 'nature' — targets every species in that collection
    spawnWeightMultiplier,
    startTime,
    endTime,
  };
  events.set(event.id, event);
  return event;
}

function listActiveEvents(now = Date.now()) {
  return [...events.values()].filter((e) => now >= e.startTime && now <= e.endTime);
}

// Combined multiplier for a species from all currently-active events (multiplicative if several overlap).
function getActiveEventMultiplier(species, now = Date.now()) {
  let multiplier = 1;
  for (const event of listActiveEvents(now)) {
    const matches =
      (event.speciesIds && event.speciesIds.includes(species.id)) ||
      (event.collection && event.collection === species.collection);
    if (matches) multiplier *= event.spawnWeightMultiplier;
  }
  return multiplier;
}

// ---- trading ----
const tradeOffers = new Map(); // id -> trade offer row

// Cooldown before a freshly-captured (or freshly-traded) droid can be
// traded again — closes the "farm easy commons on throwaway accounts,
// launder into rares via fake trades" exploit GO-likes are notorious for.
const TRADE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Small crystal fee paid by whoever RECEIVES a droid in a trade, scaled by
// rarity — keeps trading a convenience, not a strictly-better alternative
// to actually capturing rares yourself.
const TRADE_FEE_BY_RARITY = {
  common: 0,
  uncommon: 2,
  rare: 5,
  legendary: 15,
};

// ---- players ----
const players = new Map(); // id -> player row

// ---- owned_droids ----
const ownedDroids = new Map(); // id -> row

// ---- workshop_slots ----
const workshopSlots = new Map(); // id -> row

// ---- spawns ----
const spawns = new Map(); // id -> row

// ---- capture_attempts / crystal_transactions (audit logs) ----
const captureAttempts = [];
const crystalTransactions = [];

function createPlayer(username) {
  const player = {
    id: id(),
    username,
    crystalBalance: 0,
    lastCrystalCollection: Date.now(),
    createdAt: Date.now(),
    hasStarterDroid: false,
    padLevel: 0,
  };
  players.set(player.id, player);

  // give every new player 10 workshop slots (only slot 0 unlocked to start)
  for (let i = 0; i < 10; i++) {
    const slot = {
      id: id(),
      playerId: player.id,
      slotIndex: i,
      unlocked: i === 0,
      multiplier: 1.0,
    };
    workshopSlots.set(slot.id, slot);
  }

  return player;
}

// One-time free starter droid, common tier only, skips the capture step
// entirely so a brand-new player (0 crystals) can start farming even though
// real captures now require crystal power (see MIN_CRYSTAL_COST).
function grantStarterDroid(playerId, speciesId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.hasStarterDroid) throw new Error('Starter droid already claimed');

  const species = droidSpecies.find((s) => s.id === speciesId);
  if (!species || species.rarity !== 'common') {
    throw new Error('Starter droid must be a common-tier species');
  }

  const droid = {
    id: id(),
    playerId,
    speciesId: species.id,
    variant: 'standard',
    level: 1,
    capturedAt: Date.now(),
    workshopSlotId: null,
  };
  ownedDroids.set(droid.id, droid);
  player.hasStarterDroid = true;
  return droid;
}

// ---- persistence snapshot (used by persistence.js) ----
// Deliberately excludes `spawns` (ephemeral — stale/expired ones shouldn't
// come back after a restore) and `captureAttempts` (pure audit log, not
// needed for gameplay continuity, would grow the snapshot unboundedly).
// crystalTransactions is capped to the most recent 1000 for the same reason.
function exportState() {
  return {
    players: [...players.values()],
    ownedDroids: [...ownedDroids.values()],
    workshopSlots: [...workshopSlots.values()],
    tradeOffers: [...tradeOffers.values()],
    events: [...events.values()],
    crystalTransactions: crystalTransactions.slice(-1000),
  };
}

function importState(state) {
  if (!state) return;
  players.clear();
  ownedDroids.clear();
  workshopSlots.clear();
  tradeOffers.clear();
  events.clear();
  crystalTransactions.length = 0;

  (state.players || []).forEach((p) => players.set(p.id, p));
  (state.ownedDroids || []).forEach((d) => ownedDroids.set(d.id, d));
  (state.workshopSlots || []).forEach((s) => workshopSlots.set(s.id, s));
  (state.tradeOffers || []).forEach((t) => tradeOffers.set(t.id, t));
  (state.events || []).forEach((e) => events.set(e.id, e));
  (state.crystalTransactions || []).forEach((t) => crystalTransactions.push(t));

  // Recompute the id counter so newly-created rows never collide with
  // restored ones, regardless of what was in flight when the snapshot was taken.
  let maxId = 0;
  for (const coll of [players, ownedDroids, workshopSlots, tradeOffers, events]) {
    for (const row of coll.values()) if (row.id > maxId) maxId = row.id;
  }
  for (const t of crystalTransactions) if (t.id > maxId) maxId = t.id;
  nextId = maxId + 1;
}

module.exports = {
  droidSpecies,
  RARITY_TTL_MS,
  RARITY_MAX_PER_CELL,
  LEGENDARY_CITY_CAP,
  MIN_CRYSTAL_COST,
  VARIANT_ODDS,
  VARIANT_CRYSTAL_MULTIPLIER,
  TESTING_HIGH_VARIANT_ODDS,
  rollVariant,
  slotUnlockCost,
  DROID_LEVEL_CAP,
  levelUpCost,
  PAD_SKILL_CEILING_PER_LEVEL,
  padUpgradeCost,
  critChanceForPadLevel,
  events,
  createEvent,
  listActiveEvents,
  getActiveEventMultiplier,
  tradeOffers,
  TRADE_COOLDOWN_MS,
  TRADE_FEE_BY_RARITY,
  players,
  ownedDroids,
  workshopSlots,
  spawns,
  captureAttempts,
  crystalTransactions,
  createPlayer,
  grantStarterDroid,
  exportState,
  importState,
  nextId: () => id(),
};
