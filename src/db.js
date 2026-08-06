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
//
// baseHP/baseAttack: groundwork stats for a future PVE raid system (not
// yet built) — level scaling already applies to them via the same
// levelMultiplier used for crystal rate, so they're "real" numbers from day
// one even though nothing consumes them in combat yet.
const RARITY_BASE_STATS = {
  common: { hp: 50, attack: 8 },
  uncommon: { hp: 90, attack: 14 },
  rare: { hp: 150, attack: 22 },
  legendary: { hp: 260, attack: 35 },
  cosmic: { hp: 200, attack: 20 },
};
function statsFor(rarity) {
  return { baseHP: RARITY_BASE_STATS[rarity].hp, baseAttack: RARITY_BASE_STATS[rarity].attack };
}

const droidSpecies = [
  // -- common (60 total / 8 species now = 7.5 each) --
  { id: id(), name: 'Puffkin',     alignment: 'light', rarity: 'common',    collection: 'mythical', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, isStarterOption: true, ...statsFor('common') },
  { id: id(), name: 'Gloomrat',    alignment: 'dark',  rarity: 'common',    collection: 'mythical', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, isStarterOption: true, ...statsFor('common') },
  { id: id(), name: 'Leafkin',     alignment: 'light', rarity: 'common',    collection: 'nature',   baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, isStarterOption: true, ...statsFor('common') },
  { id: id(), name: 'Thornstalk',  alignment: 'dark',  rarity: 'common',    collection: 'nature',   baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, isStarterOption: true, ...statsFor('common') },
  { id: id(), name: 'Teacupper',   alignment: 'light', rarity: 'common',    collection: 'wildcard', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, ...statsFor('common') },
  { id: id(), name: 'Pangolynk',   alignment: 'light', rarity: 'common',    collection: 'wildcard', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, ...statsFor('common') },
  { id: id(), name: 'Binx',        alignment: 'dark',  rarity: 'common',    collection: 'wildcard', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, ...statsFor('common') },
  { id: id(), name: 'Shadowtad',   alignment: 'dark',  rarity: 'common',    collection: 'wildcard', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 7.5, ...statsFor('common') },

  // -- uncommon (25 total / 8 species now = 3.125 each) --
  { id: id(), name: 'Emberfox',    alignment: 'light', rarity: 'uncommon',  collection: 'mythical', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Nightfang',   alignment: 'dark',  rarity: 'uncommon',  collection: 'mythical', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Bloombot',    alignment: 'light', rarity: 'uncommon',  collection: 'nature',   baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Sporecap',    alignment: 'dark',  rarity: 'uncommon',  collection: 'nature',   baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Toastybob',   alignment: 'light', rarity: 'uncommon',  collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Redwolfe',    alignment: 'light', rarity: 'uncommon',  collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Tiktoker',    alignment: 'dark',  rarity: 'uncommon',  collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },
  { id: id(), name: 'Indrashark',  alignment: 'dark',  rarity: 'uncommon',  collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 3.125, ...statsFor('uncommon') },

  // -- rare (12 total / 8 species now = 1.5 each) --
  { id: id(), name: 'Skylantern',  alignment: 'light', rarity: 'rare',      collection: 'mythical', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Ravencowl',   alignment: 'dark',  rarity: 'rare',      collection: 'mythical', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Vineweave',   alignment: 'light', rarity: 'rare',      collection: 'nature',   baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Wiltroot',    alignment: 'dark',  rarity: 'rare',      collection: 'nature',   baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Brollybot',   alignment: 'light', rarity: 'rare',      collection: 'wildcard', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Snowleopardon', alignment: 'light', rarity: 'rare',    collection: 'wildcard', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Snapshot',    alignment: 'dark',  rarity: 'rare',      collection: 'wildcard', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },
  { id: id(), name: 'Ghostcrane',  alignment: 'dark',  rarity: 'rare',      collection: 'wildcard', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 1.5, ...statsFor('rare') },

  // -- legendary (3 total / 8 species now = 0.375 each) --
  { id: id(), name: 'Aurumwing',   alignment: 'light', rarity: 'legendary', collection: 'mythical', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Voidforge',   alignment: 'dark',  rarity: 'legendary', collection: 'mythical', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Elderwood',   alignment: 'light', rarity: 'legendary', collection: 'nature',   baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Voidtree',    alignment: 'dark',  rarity: 'legendary', collection: 'nature',   baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Packmate',    alignment: 'light', rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Oricalypse',  alignment: 'light', rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Gamebot',     alignment: 'dark',  rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },
  { id: id(), name: 'Vaantheris',  alignment: 'dark',  rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.375, ...statsFor('legendary') },

  // -- evolution-only (spawnWeight 0 -> never appears in the wild, only obtained by evolving) --
  { id: id(), name: 'Bushy',      alignment: 'light', rarity: 'uncommon',  collection: 'nature',   baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, isEvolutionOnly: true, ...statsFor('uncommon') },

  // -- companion (cosmic tier — rarer than legendary, doesn't farm, provides a % buff instead; see COMPANION_BUFF_PERCENT) --
  { id: id(), name: 'StarSprite', alignment: 'cosmic', rarity: 'cosmic',   collection: 'cosmic',   baseCaptureRate: 0.03, baseCrystalRate: 0,  spawnWeight: 0.1, isCompanion: true, companionBuffType: 'crystal', companionBuffPercent: 50, ...statsFor('cosmic') },
  { id: id(), name: 'Nebulfox',   alignment: 'cosmic', rarity: 'cosmic',   collection: 'cosmic',   baseCaptureRate: 0.03, baseCrystalRate: 0,  spawnWeight: 0.1, isCompanion: true, companionBuffType: 'capture_rate', companionBuffPercent: 100, ...statsFor('cosmic') },

  // -- Summer event-exclusive (Solar collection) — spawnWeight 0 outside the
  // event window. A normal "boost" event can't make these spawn (0 x any
  // multiplier is still 0) — they need a "grant" event instead, which adds
  // a temporary real weight rather than multiplying the existing one. See
  // createEvent()'s `mode` param and spawns.js's grant-weight handling.
  // Also flagged eventOnly so they live in a separate Event Dex, not the
  // main one (otherwise players would see permanent "???" entries they can
  // only fill during a few days a year).
  { id: id(), name: 'Sunbud',       alignment: 'light', rarity: 'common',    collection: 'solar', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, eventOnly: true, ...statsFor('common') },
  { id: id(), name: 'Solara',       alignment: 'light', rarity: 'uncommon',  collection: 'solar', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, eventOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Sundrift',     alignment: 'light', rarity: 'rare',      collection: 'solar', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Solaris Rex',  alignment: 'light', rarity: 'legendary', collection: 'solar', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },
  { id: id(), name: 'Scorchling',   alignment: 'dark',  rarity: 'common',    collection: 'solar', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, eventOnly: true, ...statsFor('common') },
  { id: id(), name: 'Heatfang',     alignment: 'dark',  rarity: 'uncommon',  collection: 'solar', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, eventOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Dustwraith',   alignment: 'dark',  rarity: 'rare',      collection: 'solar', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Infernotitan', alignment: 'dark',  rarity: 'legendary', collection: 'solar', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },
];

// Leafkin -> Bushy is the first (and template) evolution pair. Keyed by
// species id so adding more pairs later is pure data, not new code.
const leafkinSpecies = droidSpecies.find((s) => s.name === 'Leafkin');
const bushySpecies = droidSpecies.find((s) => s.name === 'Bushy');
const EVOLUTION_TABLE = {
  [leafkinSpecies.id]: { evolvesTo: bushySpecies.id, novaChipCost: 15 },
};

const RARITY_TTL_MS = {
  common: 15 * 60 * 1000,
  uncommon: 10 * 60 * 1000,
  rare: 8 * 60 * 1000,
  legendary: 5 * 60 * 1000,
  cosmic: 4 * 60 * 1000,
};

const RARITY_MAX_PER_CELL = {
  common: 3,
  uncommon: 2,
  rare: 1,
  legendary: 1,
  cosmic: 1,
};

const LEGENDARY_CITY_CAP = 3;
const COSMIC_CITY_CAP = 1; // StarSprite — only one active anywhere at a time

// ---- crystal power requirement ----
// The control pad literally needs crystals to function (per the original
// pitch) — below this, an attempt is rejected outright rather than just
// having low odds. Scales with rarity: tougher droids need more power.
const MIN_CRYSTAL_COST = {
  common: 1,
  uncommon: 5,
  rare: 15,
  legendary: 40,
  cosmic: 80,
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
  platinum: 5.0, // 500% — raised from 1.5x per playtest: original bonus wasn't worth the ~1-in-1000 hunt
  rusty: 2.0,    // 200% — originally cosmetic-only; given a real bonus per playtest feedback (see note below)
  funky: 3.5,    // 350% — midpoint between Rusty and Platinum; Rusty + banked Paint evolves into this (see evolveFunky)
};
// Note: Rusty was originally designed as purely cosmetic (see concept
// discussion) with a possible future "polish/paint evolution" mechanic —
// that mechanic now exists (evolveFunky below).

// Companion (cosmic-rarity) variants are rarer still than normal — a flat
// odds multiplier applied only when rolling a variant for a cosmic spawn.
const COMPANION_VARIANT_ODDS_MULTIPLIER = 0.1;

function rollVariant(rarity = null) {
  const scale = rarity === 'cosmic' ? COMPANION_VARIANT_ODDS_MULTIPLIER : 1;
  const roll = Math.random();
  if (roll < VARIANT_ODDS.platinum * scale) return 'platinum';
  if (roll < VARIANT_ODDS.platinum * scale + VARIANT_ODDS.rusty * scale) return 'rusty';
  return 'standard';
}

// Spend banked Paint to evolve an owned Rusty droid into a "Funky" one —
// a cosmetic primary color plus the mid-tier crystal bonus above. Paint is
// a generic banked currency (not per-color), so any color is available at
// the moment of evolving regardless of which capture(s) dropped the paint.
const FUNKY_EVOLVE_PAINT_COST = 10; // default — tune freely, not specified in the original design ask
const PRIMARY_COLORS = ['red', 'yellow', 'blue'];

// ---- workshop slot unlock cost ----
// Slot 0 is free (granted at signup, holds the starter droid). Every
// additional slot costs 50 more crystals than the last: slot1=50,
// slot2=100, slot3=150 ... slot9=450.
function slotUnlockCost(slotIndex) {
  return 50 * slotIndex;
}

// ---- droid leveling (crystals -> stronger individual droid) ----
// Effect lives in workshop.js's levelMultiplier (+15% crystal rate/level,
// now also HP/Attack — see baseHP/baseAttack above) — this is the crystal
// cost to buy the next level, scaled by rarity so a Legendary costs
// meaningfully more to level than a Common.
const DROID_LEVEL_CAP = 20;
const RARITY_LEVEL_COST_MULTIPLIER = {
  common: 1,
  uncommon: 1.5,
  rare: 2.5,
  legendary: 4,
  cosmic: 5,
};
function levelUpCost(currentLevel, rarity = 'common') {
  const multiplier = RARITY_LEVEL_COST_MULTIPLIER[rarity] ?? 1;
  return Math.round(10 * Math.pow(currentLevel, 1.6) * multiplier);
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
const EVENT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const lastEventLaunchByTarget = new Map(); // targetKey -> timestamp

function eventTargetKey({ speciesIds = [], collection = null }) {
  return collection ? `collection:${collection}` : `species:${[...speciesIds].sort().join(',')}`;
}

// Per-rarity spawn weight granted to Solar-collection species while a
// "grant" event targeting them is active — mirrors the internal
// common/uncommon/rare/legendary proportions the Mythical/Nature
// collections already use (15 / 6.25 / 3 / 0.75), so Summer feels
// consistent with the base spawn rates once it's live.
const SOLAR_GRANT_WEIGHT_BY_RARITY = { common: 15, uncommon: 6.25, rare: 3, legendary: 0.75 };

function createEvent({ name, mode = 'boost', speciesIds = [], collection = null, spawnWeightMultiplier = 2, grantWeights = null, startTime, endTime }) {
  const targetKey = eventTargetKey({ speciesIds, collection });
  const lastLaunch = lastEventLaunchByTarget.get(targetKey);
  if (lastLaunch && Date.now() - lastLaunch < EVENT_COOLDOWN_MS) {
    const remainingMs = EVENT_COOLDOWN_MS - (Date.now() - lastLaunch);
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    throw new Error(`This event target is on cooldown for another ~${remainingHours}h`);
  }
  if (mode === 'grant' && !speciesIds.length) {
    throw new Error('Grant-mode events need explicit speciesIds (grants don\'t make sense for a whole collection)');
  }

  // Auto-fill grant weights from rarity if the caller didn't specify exact values.
  let resolvedGrantWeights = grantWeights;
  if (mode === 'grant' && !resolvedGrantWeights) {
    resolvedGrantWeights = {};
    speciesIds.forEach((sid) => {
      const sp = droidSpecies.find((s) => s.id === sid);
      if (sp) resolvedGrantWeights[sid] = SOLAR_GRANT_WEIGHT_BY_RARITY[sp.rarity] ?? 3;
    });
  }

  const event = {
    id: id(),
    name,
    mode,         // 'boost' (multiplies existing weight) | 'grant' (adds a real weight to a zero-weight species)
    speciesIds,   // explicit species targets, OR
    collection,   // 'mythical' | 'nature' — targets every species in that collection (boost mode only)
    spawnWeightMultiplier,
    grantWeights: resolvedGrantWeights, // { speciesId: weight } — grant mode only
    startTime,
    endTime,
  };
  events.set(event.id, event);
  lastEventLaunchByTarget.set(targetKey, Date.now());
  return event;
}

function listActiveEvents(now = Date.now()) {
  return [...events.values()].filter((e) => now >= e.startTime && now <= e.endTime);
}

// Extra spawn weight granted to a species by any active grant-mode event
// targeting it — additive, not multiplicative, so it works even when the
// species' own base weight is 0.
function getActiveEventGrant(species, now = Date.now()) {
  let grant = 0;
  for (const event of listActiveEvents(now)) {
    if (event.mode === 'grant' && event.grantWeights && event.grantWeights[species.id] != null) {
      grant += event.grantWeights[species.id];
    }
  }
  return grant;
}

// Combined multiplier for a species from all currently-active events (multiplicative if several overlap).
function getActiveEventMultiplier(species, now = Date.now()) {
  let multiplier = 1;
  for (const event of listActiveEvents(now)) {
    if (event.mode !== 'boost') continue;
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

// ---- companion droids (StarSprite, Nebulfox) ----
// Structurally different from farming droids: doesn't occupy a workshop
// slot, doesn't farm crystals itself. Each companion species defines its
// own buff via companionBuffType ('crystal' | 'capture_rate') and
// companionBuffPercent — see workshop.js's companionBuffMultiplier and
// capture.js's companionCaptureRateMultiplier.
//
// capture_rate buffs (Nebulfox) are strong enough to need gating: rather
// than always-on while equipped (like StarSprite's crystal buff), they
// require an explicit activation, run for a limited window, then go on
// cooldown — timed per DROID, not per player, so owning two Nebulfoxes
// gives two independent timers you can stagger.
const CAPTURE_RATE_BUFF_DURATION_MS = 60 * 60 * 1000; // 1 hour active
const CAPTURE_RATE_BUFF_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours after it ends, before that droid can reactivate

function activateCompanionBuff(playerId, droidId) {
  const player = players.get(playerId);
  const droid = ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  const species = droidSpecies.find((s) => s.id === droid.speciesId);
  if (!species || !species.isCompanion || species.companionBuffType !== 'capture_rate') {
    throw new Error('Only capture-rate companions (e.g. Nebulfox) need activating');
  }
  if (player.companionDroidId !== droidId) throw new Error('Equip this companion before activating its buff');

  const now = Date.now();
  if (droid.buffActiveUntil && now < droid.buffActiveUntil) {
    throw new Error('Buff is already active');
  }
  if (droid.buffCooldownUntil && now < droid.buffCooldownUntil) {
    const minsLeft = Math.ceil((droid.buffCooldownUntil - now) / (60 * 1000));
    throw new Error(`This droid's buff is on cooldown for another ~${minsLeft}m`);
  }

  droid.buffActiveUntil = now + CAPTURE_RATE_BUFF_DURATION_MS;
  droid.buffCooldownUntil = droid.buffActiveUntil + CAPTURE_RATE_BUFF_COOLDOWN_MS;
  return { buffActiveUntil: droid.buffActiveUntil, buffCooldownUntil: droid.buffCooldownUntil };
}

// ---- cosmetics ----
// Purely cosmetic, no gameplay effect — crystal sinks for players who've
// maxed out the practical stuff. Extensible catalog; just one item for
// this beta round.
const COSMETICS_CATALOG = [
  { id: 'beta_crown', name: 'Beta Crown', cost: 1000, description: 'No effect - just shows you were here for the beta.' },
];

// ---- guilds ----
// Minimal for now: a name and a member list, no gameplay effect yet -
// foundation for a future PVP/guild system. Small friend-group cap.
const guilds = new Map(); // id -> guild row
const GUILD_MAX_MEMBERS = 12;

const GUILD_KICK_GLOBAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day before joining ANY guild
const GUILD_KICK_SAME_GUILD_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days before rejoining THAT guild

function createGuild(playerId, name) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.guildId) throw new Error('Already in a guild - leave it first');
  const guild = { id: id(), name, creatorId: playerId, memberIds: [playerId], createdAt: Date.now() };
  guilds.set(guild.id, guild);
  player.guildId = guild.id;
  return guild;
}

function joinGuild(playerId, guildId) {
  const player = players.get(playerId);
  const guild = guilds.get(guildId);
  if (!player) throw new Error('Player not found');
  if (!guild) throw new Error('Guild not found');
  if (player.guildId) throw new Error('Already in a guild - leave it first');
  if (guild.memberIds.length >= GUILD_MAX_MEMBERS) throw new Error('Guild is full');

  const now = Date.now();
  if (player.guildJoinCooldownUntil && now < player.guildJoinCooldownUntil) {
    const hoursLeft = Math.ceil((player.guildJoinCooldownUntil - now) / (60 * 60 * 1000));
    throw new Error(`You were recently kicked from a guild — can join a new one in ~${hoursLeft}h`);
  }
  const sameGuildBlockUntil = player.guildRejoinBlocks && player.guildRejoinBlocks[guildId];
  if (sameGuildBlockUntil && now < sameGuildBlockUntil) {
    const daysLeft = Math.ceil((sameGuildBlockUntil - now) / (24 * 60 * 60 * 1000));
    throw new Error(`You were kicked from this guild — can rejoin it in ~${daysLeft}d`);
  }

  guild.memberIds.push(playerId);
  player.guildId = guildId;
  return guild;
}

function leaveGuild(playerId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!player.guildId) throw new Error('Not in a guild');
  const guild = guilds.get(player.guildId);
  if (guild) guild.memberIds = guild.memberIds.filter((mid) => mid !== playerId);
  player.guildId = null;
  return guild;
}

// Creator-only. Kicked player gets a 1-day cooldown before joining ANY
// guild, and a separate 30-day block specifically on rejoining this one.
function kickFromGuild(kickerId, guildId, targetPlayerId) {
  const guild = guilds.get(guildId);
  const target = players.get(targetPlayerId);
  if (!guild) throw new Error('Guild not found');
  if (!target) throw new Error('Player not found');
  if (guild.creatorId !== kickerId) throw new Error('Only the guild creator can kick members');
  if (targetPlayerId === kickerId) throw new Error('Cannot kick yourself — use Leave instead');
  if (!guild.memberIds.includes(targetPlayerId)) throw new Error('That player is not in this guild');

  guild.memberIds = guild.memberIds.filter((mid) => mid !== targetPlayerId);
  target.guildId = null;
  const now = Date.now();
  target.guildJoinCooldownUntil = now + GUILD_KICK_GLOBAL_COOLDOWN_MS;
  if (!target.guildRejoinBlocks) target.guildRejoinBlocks = {};
  target.guildRejoinBlocks[guildId] = now + GUILD_KICK_SAME_GUILD_COOLDOWN_MS;
  return guild;
}

// ---- guild chat (refresh-based — no real-time push in this app) ----
const guildMessages = new Map(); // guildId -> array of message rows
const GUILD_CHAT_MAX_HISTORY = 200; // per guild, oldest trimmed off

function postGuildMessage(playerId, guildId, text) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.guildId !== guildId) throw new Error('Not a member of this guild');
  const trimmed = (text || '').trim().slice(0, 500);
  if (!trimmed) throw new Error('Message cannot be empty');

  const message = { id: id(), playerId, username: player.username, text: trimmed, createdAt: Date.now() };
  const history = guildMessages.get(guildId) || [];
  history.push(message);
  if (history.length > GUILD_CHAT_MAX_HISTORY) history.shift();
  guildMessages.set(guildId, history);
  return message;
}

function getGuildMessages(guildId) {
  return guildMessages.get(guildId) || [];
}

// Dex completion leaderboard for a guild's members — reuses getDex's
// counting logic (defined further down) via a lazy require-free call
// since getDex is in the same module.
function getGuildLeaderboard(guildId) {
  const guild = guilds.get(guildId);
  if (!guild) throw new Error('Guild not found');
  return guild.memberIds
    .map((pid) => {
      const player = players.get(pid);
      if (!player) return null;
      const dex = getDex(pid);
      return { playerId: pid, username: player.username, totalCaught: dex.totalCaught, totalSpecies: dex.totalSpecies, percentComplete: dex.percentComplete };
    })
    .filter(Boolean)
    .sort((a, b) => b.totalCaught - a.totalCaught);
}

// ---- wishlist (public "looking for" board) ----
// Visible to everyone — any player can browse what others want and offer
// a trade. Two wish types: a specific droid (species + optional
// variant/color preference) or Paint (with a color preference, since
// Paint itself isn't tied to any species). Not linked to trades directly
// except via an optional wishId on a trade offer — see trades.js — which
// auto-marks the wish fulfilled once that trade is accepted.
const wishlist = new Map(); // id -> wish row

function createWish(playerId, opts) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  const wishType = opts.wishType;
  const speciesId = opts.speciesId || null;
  const variantWanted = opts.variantWanted || 'any';
  const colorWanted = opts.colorWanted || 'any';
  const note = opts.note || '';
  if (!['droid', 'paint'].includes(wishType)) throw new Error('wishType must be "droid" or "paint"');
  if (wishType === 'droid' && !speciesId) throw new Error('speciesId required for a droid wish');
  if (!['any', 'rusty', 'platinum'].includes(variantWanted)) throw new Error('variantWanted must be any/rusty/platinum');
  if (!['any', ...PRIMARY_COLORS].includes(colorWanted)) throw new Error(`colorWanted must be any/${PRIMARY_COLORS.join('/')}`);

  const wish = {
    id: id(),
    playerId,
    wishType,
    speciesId,
    variantWanted,
    colorWanted,
    note,
    createdAt: Date.now(),
    fulfilled: false,
  };
  wishlist.set(wish.id, wish);
  return wish;
}

function listWishes(activeOnly = true) {
  const all = [...wishlist.values()];
  const filtered = activeOnly ? all.filter((w) => !w.fulfilled) : all;
  return filtered.map((w) => {
    const wisher = players.get(w.playerId);
    const species = w.speciesId ? droidSpecies.find((s) => s.id === w.speciesId) : null;
    return { ...w, playerUsername: wisher ? wisher.username : '(unknown)', speciesName: species ? species.name : null };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

function cancelWish(playerId, wishId) {
  const wish = wishlist.get(wishId);
  if (!wish) throw new Error('Wish not found');
  if (wish.playerId !== playerId) throw new Error('Not your wish to cancel');
  wishlist.delete(wishId);
  return { deleted: true };
}

function markWishFulfilled(wishId) {
  const wish = wishlist.get(wishId);
  if (wish) wish.fulfilled = true;
}

// ---- redeem codes ----
// Simple promo-code system: a code grants crystals and/or a specific
// droid species, usable once per player, optionally capped in total uses.
const redeemCodes = new Map(); // code (uppercased) -> row

function createRedeemCode(opts) {
  const code = opts.code, rewardCrystals = opts.rewardCrystals || 0, rewardSpeciesId = opts.rewardSpeciesId || null, maxUses = opts.maxUses != null ? opts.maxUses : null;
  const key = code.toUpperCase();
  const row = { code: key, rewardCrystals, rewardSpeciesId, maxUses, usedByPlayerIds: [] };
  redeemCodes.set(key, row);
  return row;
}

function redeemCodeFn(playerId, code) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  const row = redeemCodes.get(code.toUpperCase());
  if (!row) throw new Error('Invalid code');
  if (row.usedByPlayerIds.includes(playerId)) throw new Error('You already redeemed this code');
  if (row.maxUses !== null && row.usedByPlayerIds.length >= row.maxUses) throw new Error('This code has been fully redeemed');

  row.usedByPlayerIds.push(playerId);
  player.crystalBalance += row.rewardCrystals;
  if (row.rewardCrystals > 0) {
    crystalTransactions.push({ id: id(), playerId: playerId, amount: row.rewardCrystals, source: 'redeem_code', createdAt: Date.now() });
  }

  let droid = null;
  if (row.rewardSpeciesId) {
    const species = droidSpecies.find((s) => s.id === row.rewardSpeciesId);
    if (species) {
      droid = {
        id: id(),
        playerId: playerId,
        speciesId: species.id,
        variant: 'standard',
        level: 1,
        captureCost: 0,
        capturedAt: Date.now(),
        workshopSlotId: null,
      };
      ownedDroids.set(droid.id, droid);
      markDexSeen(playerId, species.id, 'standard');
    }
  }

  return { crystalsGranted: row.rewardCrystals, droid: droid, crystalBalance: player.crystalBalance };
}

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

// ---- auth (username + PIN, cross-device login) ----
// Deliberately simple ("soft") for a closed friends beta: PIN stored in
// plain text, no hashing/salting. Fine for trusted testers with no
// sensitive data at stake; NOT appropriate once this has real users.
function findPlayerByUsername(username) {
  const lower = username.toLowerCase();
  return [...players.values()].find((p) => p.username.toLowerCase() === lower) || null;
}

function createPlayer(username, pin) {
  const player = {
    id: id(),
    username,
    pin: pin || null,
    crystalBalance: 0,
    lastCrystalCollection: Date.now(),
    createdAt: Date.now(),
    lastOnline: Date.now(),
    hasStarterDroid: false,
    padLevel: 0,
    dexSeen: [],         // speciesIds ever successfully captured — survives trading the droid away later
    dexVariantsSeen: [],  // "speciesId:variant" strings, for platinum/rusty/funky dex badges
    novaChips: 0,
    paint: 0,
    companionDroidId: null,
    cosmetics: [],
    guildId: null,
    guildJoinCooldownUntil: null,
    guildRejoinBlocks: {},
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

// Unified login/signup: if the username exists, validate the PIN (or, for
// pre-login-system accounts with no PIN set yet, "claim" it with whatever
// PIN is entered now — lets existing testers keep their progress after
// this update without a separate migration step). If the username is new,
// creates a fresh player.
function loginOrCreatePlayer(username, pin) {
  if (!username || !username.trim()) throw new Error('Username required');
  if (!pin || !/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4-8 digits');

  const existing = findPlayerByUsername(username.trim());
  if (existing) {
    if (existing.pin === null) {
      existing.pin = pin; // claim: first login after the login system was added
      existing.lastOnline = Date.now();
      return existing;
    }
    if (existing.pin !== pin) throw new Error('Wrong PIN for that username');
    existing.lastOnline = Date.now();
    return existing;
  }

  return createPlayer(username.trim(), pin);
}

// One-time free starter droid, common tier only, skips the capture step
// entirely so a brand-new player (0 crystals) can start farming even though
// real captures now require crystal power (see MIN_CRYSTAL_COST).
function grantStarterDroid(playerId, speciesId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.hasStarterDroid) throw new Error('Starter droid already claimed');

  const species = droidSpecies.find((s) => s.id === speciesId);
  if (!species || !species.isStarterOption) {
    throw new Error('That species is not a valid starter option');
  }

  const droid = {
    id: id(),
    playerId,
    speciesId: species.id,
    variant: 'standard',
    level: 1,
    captureCost: 0, // free — starter droids refund nothing if released
    capturedAt: Date.now(),
    workshopSlotId: null,
  };
  ownedDroids.set(droid.id, droid);
  player.hasStarterDroid = true;
  markDexSeen(playerId, species.id, 'standard');
  return droid;
}

function markDexSeen(playerId, speciesId, variant, color) {
  const player = players.get(playerId);
  if (!player) return;
  if (!player.dexSeen.includes(speciesId)) player.dexSeen.push(speciesId);
  if (variant && variant !== 'standard') {
    const key = `${speciesId}:${variant}`;
    if (!player.dexVariantsSeen.includes(key)) player.dexVariantsSeen.push(key);
    if (variant === 'funky' && color) {
      const colorKey = `${speciesId}:funky:${color}`;
      if (!player.dexVariantsSeen.includes(colorKey)) player.dexVariantsSeen.push(colorKey);
    }
  }
}

// Full species catalog annotated with whether this player has ever caught
// each one — a droid traded away still counts, since dexSeen is tracked
// independently of current ownership.
function getDex(playerId) {
  const player = players.get(playerId);
  const seen = player ? player.dexSeen : [];
  const variantsSeen = player ? player.dexVariantsSeen : [];

  // Evolution targets (e.g. Bushy) are placed right after their origin
  // species (e.g. Leafkin) instead of wherever they happen to sit in the
  // catalog array, so the Dex reads as a natural progression. Excludes
  // eventOnly species (e.g. the Solar collection) — those go in a
  // separate Event Dex below, not interleaved here.
  const evolvesToIds = new Set(Object.values(EVOLUTION_TABLE).map((e) => e.evolvesTo));
  const mainSpeciesPool = droidSpecies.filter((s) => !s.eventOnly);
  const orderedSpecies = [];
  mainSpeciesPool.forEach((s) => {
    if (evolvesToIds.has(s.id)) return; // placed inline below instead
    orderedSpecies.push(s);
    const evolution = EVOLUTION_TABLE[s.id];
    if (evolution) {
      const evolvedSpecies = mainSpeciesPool.find((e) => e.id === evolution.evolvesTo);
      if (evolvedSpecies) orderedSpecies.push(evolvedSpecies);
    }
  });

  const buildEntry = (s) => {
    const funkyColorsCaught = PRIMARY_COLORS.filter((c) => variantsSeen.includes(`${s.id}:funky:${c}`));
    return {
      ...s,
      caught: seen.includes(s.id),
      variantsCaught: ['platinum', 'rusty', 'funky'].filter((v) => variantsSeen.includes(`${s.id}:${v}`)),
      funkyColorsCaught,
    };
  };

  const entries = orderedSpecies.map(buildEntry);
  const eventEntries = droidSpecies.filter((s) => s.eventOnly).map(buildEntry);
  const totalCaught = entries.filter((e) => e.caught).length;
  return {

    entries,
    eventEntries,
    totalCaught,
    totalSpecies: entries.length,
    percentComplete: Math.round((totalCaught / entries.length) * 100),
  };
}

// ---- admin: player management ----
// Lists every player with basic identifying info + last-online, for
// cleaning up throwaway/duplicate test accounts.
function listPlayersAdmin() {
  return [...players.values()]
    .map((p) => ({
      id: p.id,
      username: p.username,
      crystalBalance: p.crystalBalance,
      droidCount: [...ownedDroids.values()].filter((d) => d.playerId === p.id).length,
      lastOnline: p.lastOnline,
      createdAt: p.createdAt,
      guildId: p.guildId,
    }))
    .sort((a, b) => (b.lastOnline || 0) - (a.lastOnline || 0));
}

// Cascading delete — removes everything attached to this player so
// nothing is left orphaned (a trade offer pointing at a player who no
// longer exists, a guild membership that never gets cleaned up, etc).
function deletePlayerAdmin(playerId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');

  for (const [did, droid] of ownedDroids.entries()) {
    if (droid.playerId === playerId) ownedDroids.delete(did);
  }
  for (const [sid, slot] of workshopSlots.entries()) {
    if (slot.playerId === playerId) workshopSlots.delete(sid);
  }
  for (const offer of tradeOffers.values()) {
    if (offer.status === 'pending' && (offer.fromPlayerId === playerId || offer.toPlayerId === playerId)) {
      offer.status = 'declined'; // don't delete the record, just resolve it — keeps trade history consistent
      offer.resolvedAt = Date.now();
    }
  }
  for (const [wid, wish] of wishlist.entries()) {
    if (wish.playerId === playerId) wishlist.delete(wid);
  }
  if (player.guildId) {
    const guild = guilds.get(player.guildId);
    if (guild) guild.memberIds = guild.memberIds.filter((mid) => mid !== playerId);
  }

  players.delete(playerId);
  return { deleted: true, playerId };
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
    guilds: [...guilds.values()],
    redeemCodes: [...redeemCodes.values()],
    lastEventLaunchByTarget: [...lastEventLaunchByTarget.entries()],
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
  guilds.clear();
  redeemCodes.clear();
  lastEventLaunchByTarget.clear();
  crystalTransactions.length = 0;

  // Backfill defaults for any player field added by later code than what
  // originally saved this snapshot — e.g. a player saved before the Dex
  // feature existed won't have `dexSeen` in their saved JSON. Spreading
  // defaults first, then the restored row, keeps every real saved value
  // and only fills in what's actually missing (object spread never
  // overwrites a key the source doesn't have).
  const playerDefaults = {
    pin: null,
    hasStarterDroid: false,
    padLevel: 0,
    dexSeen: [],
    dexVariantsSeen: [],
    novaChips: 0,
    paint: 0,
    companionDroidId: null,
    cosmetics: [],
    guildId: null,
    lastOnline: null,
    guildJoinCooldownUntil: null,
    guildRejoinBlocks: {},
  };
  (state.players || []).forEach((p) => players.set(p.id, { ...playerDefaults, ...p }));

  const droidDefaults = { level: 1, variant: 'standard', workshopSlotId: null, captureCost: 0 };
  (state.ownedDroids || []).forEach((d) => ownedDroids.set(d.id, { ...droidDefaults, ...d }));

  (state.workshopSlots || []).forEach((s) => workshopSlots.set(s.id, s));
  (state.tradeOffers || []).forEach((t) => tradeOffers.set(t.id, t));
  (state.events || []).forEach((e) => events.set(e.id, e));
  (state.guilds || []).forEach((g) => guilds.set(g.id, g));
  (state.redeemCodes || []).forEach((r) => redeemCodes.set(r.code, r));
  (state.lastEventLaunchByTarget || []).forEach(([k, v]) => lastEventLaunchByTarget.set(k, v));
  (state.crystalTransactions || []).forEach((t) => crystalTransactions.push(t));

  // Recompute the id counter so newly-created rows never collide with
  // restored ones, regardless of what was in flight when the snapshot was taken.
  let maxId = 0;
  for (const coll of [players, ownedDroids, workshopSlots, tradeOffers, events, guilds]) {
    for (const row of coll.values()) if (row.id > maxId) maxId = row.id;
  }
  for (const t of crystalTransactions) if (t.id > maxId) maxId = t.id;
  nextId = maxId + 1;
}

module.exports = {
  droidSpecies,
  EVOLUTION_TABLE,
  RARITY_TTL_MS,
  RARITY_MAX_PER_CELL,
  LEGENDARY_CITY_CAP,
  COSMIC_CITY_CAP,
  MIN_CRYSTAL_COST,
  VARIANT_ODDS,
  VARIANT_CRYSTAL_MULTIPLIER,
  TESTING_HIGH_VARIANT_ODDS,
  rollVariant,
  FUNKY_EVOLVE_PAINT_COST,
  PRIMARY_COLORS,
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
  getActiveEventGrant,
  SOLAR_GRANT_WEIGHT_BY_RARITY,
  EVENT_COOLDOWN_MS,
  tradeOffers,
  TRADE_COOLDOWN_MS,
  TRADE_FEE_BY_RARITY,
  COSMETICS_CATALOG,
  guilds,
  GUILD_MAX_MEMBERS,
  createGuild,
  joinGuild,
  leaveGuild,
  kickFromGuild,
  postGuildMessage,
  getGuildMessages,
  getGuildLeaderboard,
  activateCompanionBuff,
  listPlayersAdmin,
  deletePlayerAdmin,
  redeemCodes,
  createRedeemCode,
  redeemCodeFn,
  wishlist,
  createWish,
  listWishes,
  cancelWish,
  markWishFulfilled,
  players,
  ownedDroids,
  workshopSlots,
  spawns,
  captureAttempts,
  crystalTransactions,
  createPlayer,
  findPlayerByUsername,
  loginOrCreatePlayer,
  grantStarterDroid,
  markDexSeen,
  getDex,
  exportState,
  importState,
  nextId: () => id(),
};
