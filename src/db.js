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
const presence = require('./presence');

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
  galactic: { hp: 400, attack: 50 }, // meaningfully above Legendary, matches the confirmed "substantially bigger" design intent
  // Apex — the endgame tier. Sits clearly above Galactic (400/50) so the
  // set reads as a genuine step up rather than a sidegrade. The huge HP
  // pool is deliberate: Apex battles are balanced around a group, and a
  // solo player should visibly fail to out-damage one.
  apex: { hp: 2200, attack: 140 },
};
function statsFor(rarity) {
  return { baseHP: RARITY_BASE_STATS[rarity].hp, baseAttack: RARITY_BASE_STATS[rarity].attack };
}

// Football roster spawn window — Light 3-5pm, Dark 8-10pm, Saturday and
// Sunday only (0=Sun, 6=Sat). Checked in spawns.js via isFootballWindowActive().
const FOOTBALL_WINDOWS = {
  light: { days: [0, 6], startHour: 15, endHour: 17 },
  dark: { days: [0, 6], startHour: 20, endHour: 22 },
};
// Per-species footballWeight, active only during the window above: each
// rarity tier's usual total (60/25/12/3) split across however many
// football species share that tier (uneven counts, unlike every other
// collection): Common 3 -> 20 each, Uncommon 6 -> ~4.17 each, Rare 6 -> 2
// each, Legendary 5 -> 0.6 each.
const FOOTBALL_TIER_WEIGHT = { common: 60 / 3, uncommon: 25 / 6, rare: 12 / 6, legendary: 3 / 5 };

// Void Zombies (dark, 11pm-1am daily) and Lumen Sentinels (light,
// 11am-1pm daily) — same additive, non-destructive spawn pattern as
// Football, but no day-of-week gate, just a nightly/daily hour window
// every day. Only Common/Uncommon spawn wild; Rare/Legendary are
// evolution-only (see EVOLUTION_TABLE below).
const DAILY_LINE_WINDOWS = {
  void_zombie: { startHour: 23, endHour: 25 }, // 25 = wraps past midnight to 1am
  lumen_sentinel: { startHour: 11, endHour: 13 },
};
// Each line has exactly one wild-spawnable species per tier (unlike every
// other collection's 2-per-side split), so each gets the full tier
// baseline weight rather than splitting it with a sibling.
const DAILY_LINE_TIER_WEIGHT = { common: 60 }; // only Common spawns wild in these lines now — Uncommon/Rare/Legendary are all evolution-only, full 4-tier chain

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
  { id: id(), name: 'StarSprite', alignment: 'cosmic', rarity: 'cosmic',   collection: 'cosmic',   baseCaptureRate: 0.03, baseCrystalRate: 0,  spawnWeight: 0.1, isCompanion: true, companionBuffType: 'crystal', companionBuffPercent: 50, companionBuffDurationMs: 2 * 60 * 60 * 1000, ...statsFor('cosmic') },
  { id: id(), name: 'Nebulfox',   alignment: 'cosmic', rarity: 'cosmic',   collection: 'cosmic',   baseCaptureRate: 0.03, baseCrystalRate: 0,  spawnWeight: 0.1, isCompanion: true, companionBuffType: 'capture_rate', companionBuffPercent: 100, companionBuffDurationMs: 60 * 60 * 1000, ...statsFor('cosmic') },
  { id: id(), name: 'The Enforcer', alignment: 'cosmic', rarity: 'cosmic', collection: 'cosmic', baseCaptureRate: 0.015, baseCrystalRate: 0, spawnWeight: 0.05, isCompanion: true, companionBuffType: 'damage', companionBuffPercent: 100, companionBuffDurationMs: 60 * 60 * 1000, ...statsFor('cosmic') },

  // -- Football roster (20 species) — Light spawns 3-5pm, Dark spawns
  // 8-10pm, Saturday/Sunday only (see FOOTBALL_WINDOWS above). Deliberately
  // in the MAIN Dex (not a separate Event Dex like Solar) — a controlled
  // long-tail difficulty mechanism, not a time-limited event. spawnWeight
  // stays 0 always; footballWeight only applies inside the active window.
  { id: id(), name: 'Cherrybyte',  alignment: 'dark',  rarity: 'common',    collection: 'football', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.common, ...statsFor('common') },
  { id: id(), name: 'Ironfang',    alignment: 'dark',  rarity: 'uncommon',  collection: 'football', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.uncommon, ...statsFor('uncommon') },
  { id: id(), name: 'Rootcore',    alignment: 'dark',  rarity: 'uncommon',  collection: 'football', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.uncommon, ...statsFor('uncommon') },
  { id: id(), name: 'Emberhart',   alignment: 'dark',  rarity: 'uncommon',  collection: 'football', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.uncommon, ...statsFor('uncommon') },
  { id: id(), name: 'Regalion',    alignment: 'dark',  rarity: 'rare',      collection: 'football', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.rare, ...statsFor('rare') },
  { id: id(), name: 'Hammerclad',  alignment: 'dark',  rarity: 'rare',      collection: 'football', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.rare, ...statsFor('rare') },
  { id: id(), name: 'Skytalon',    alignment: 'dark',  rarity: 'rare',      collection: 'football', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.rare, ...statsFor('rare') },
  { id: id(), name: 'Cannix',      alignment: 'dark',  rarity: 'legendary', collection: 'football', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.legendary, ...statsFor('legendary') },
  { id: id(), name: 'Redforge',    alignment: 'dark',  rarity: 'legendary', collection: 'football', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.legendary, ...statsFor('legendary') },
  { id: id(), name: 'Liverflare',  alignment: 'dark',  rarity: 'legendary', collection: 'football', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.legendary, ...statsFor('legendary') },

  { id: id(), name: 'Scarforge',   alignment: 'light', rarity: 'common',    collection: 'football', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.common, ...statsFor('common') },
  { id: id(), name: 'Plumebolt',   alignment: 'light', rarity: 'common',    collection: 'football', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.common, ...statsFor('common') },
  { id: id(), name: 'Gullstrike',  alignment: 'light', rarity: 'uncommon',  collection: 'football', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.uncommon, ...statsFor('uncommon') },
  { id: id(), name: 'Rivershield', alignment: 'light', rarity: 'uncommon',  collection: 'football', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.uncommon, ...statsFor('uncommon') },
  { id: id(), name: 'Hexasting',   alignment: 'light', rarity: 'uncommon',  collection: 'football', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.uncommon, ...statsFor('uncommon') },
  { id: id(), name: 'Lionvolt',    alignment: 'light', rarity: 'rare',      collection: 'football', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.rare, ...statsFor('rare') },
  { id: id(), name: 'Magpiex',     alignment: 'light', rarity: 'rare',      collection: 'football', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.rare, ...statsFor('rare') },
  { id: id(), name: 'Towerguard',  alignment: 'light', rarity: 'rare',      collection: 'football', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.rare, ...statsFor('rare') },
  { id: id(), name: 'Spurwing',    alignment: 'light', rarity: 'legendary', collection: 'football', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.legendary, ...statsFor('legendary') },
  { id: id(), name: 'Skymane',     alignment: 'light', rarity: 'legendary', collection: 'football', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, footballWeight: FOOTBALL_TIER_WEIGHT.legendary, ...statsFor('legendary') },

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

  // -- Void Zombies (dark, 11pm-1am daily). Common/Uncommon wild-spawn via
  // dailyWeight; Rare/Legendary are evolution-only (see EVOLUTION_TABLE).
  { id: id(), name: 'Shambler',  alignment: 'dark', rarity: 'common',    collection: 'void_zombie', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, dailyWeight: DAILY_LINE_TIER_WEIGHT.common, ...statsFor('common') },
  { id: id(), name: 'Walker',    alignment: 'dark', rarity: 'uncommon',  collection: 'void_zombie', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, isEvolutionOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Corruptor', alignment: 'dark', rarity: 'rare',      collection: 'void_zombie', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, isEvolutionOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Voidlord',  alignment: 'dark', rarity: 'legendary', collection: 'void_zombie', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('legendary') },
  // Confirmed name — 5th tier of the Zombie line, new Cosmic-rarity cap
  { id: id(), name: 'Voidsovereign', alignment: 'dark', rarity: 'cosmic', collection: 'void_zombie', baseCaptureRate: 0.02, baseCrystalRate: 35, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('cosmic') },

  // -- Lumen Sentinels (light, 11am-1pm daily). Same structure as above.
  { id: id(), name: 'Illume',     alignment: 'light', rarity: 'common',    collection: 'lumen_sentinel', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, dailyWeight: DAILY_LINE_TIER_WEIGHT.common, ...statsFor('common') },
  { id: id(), name: 'Lumenguard', alignment: 'light', rarity: 'uncommon',  collection: 'lumen_sentinel', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, isEvolutionOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Luminor',    alignment: 'light', rarity: 'rare',      collection: 'lumen_sentinel', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, isEvolutionOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Luxion',     alignment: 'light', rarity: 'legendary', collection: 'lumen_sentinel', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('legendary') },
  // Confirmed name — 5th tier of the Lumen line, new Cosmic-rarity cap
  { id: id(), name: 'Luminarch', alignment: 'light', rarity: 'cosmic', collection: 'lumen_sentinel', baseCaptureRate: 0.02, baseCrystalRate: 35, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('cosmic') },

  // -- Bulk import: Sproutix/Nebulyx/Aurora-X sets (64 droids) --
  { id: id(), name: 'Sproutix', alignment: 'light', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Buzzi', alignment: 'dark', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Orbi', alignment: 'light', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Mewlite', alignment: 'dark', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Zappi', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Glimmerpaw', alignment: 'dark', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Wisp', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Spikee', alignment: 'dark', rarity: 'rare', collection: 'wildcard', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Shadelet', alignment: 'light', rarity: 'rare', collection: 'wildcard', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Treadix', alignment: 'dark', rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.1, ...statsFor('legendary') },
  { id: id(), name: 'Venomite', alignment: 'light', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Pixelbob', alignment: 'dark', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Aquajewel', alignment: 'light', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Crystolith', alignment: 'dark', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Lampkin', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Hootron', alignment: 'dark', rarity: 'uncommon', collection: 'nature', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Diggy', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Stellaris', alignment: 'cosmic', rarity: 'rare', collection: 'cosmic', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Shroombo', alignment: 'light', rarity: 'rare', collection: 'nature', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Nightscythe', alignment: 'dark', rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.1, ...statsFor('legendary') },
  { id: id(), name: 'Recycl-8', alignment: 'light', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Batti', alignment: 'dark', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Grimblot', alignment: 'light', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Lumifly', alignment: 'dark', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Nebulyx', alignment: 'cosmic', rarity: 'uncommon', collection: 'cosmic', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Quasar-X', alignment: 'cosmic', rarity: 'uncommon', collection: 'cosmic', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Pulsarowl', alignment: 'cosmic', rarity: 'uncommon', collection: 'cosmic', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Supernova Pup', alignment: 'cosmic', rarity: 'rare', collection: 'cosmic', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Orbitclaw', alignment: 'cosmic', rarity: 'rare', collection: 'cosmic', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Voidkit', alignment: 'cosmic', rarity: 'legendary', collection: 'cosmic', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.1, ...statsFor('legendary') },
  { id: id(), name: 'Cometbee', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Singularity Bit', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Galaxy Fern', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Wormhole Walker', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Stellar Wing', alignment: 'cosmic', rarity: 'uncommon', collection: 'cosmic', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Meteor Toad', alignment: 'cosmic', rarity: 'uncommon', collection: 'cosmic', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Astral Cat', alignment: 'cosmic', rarity: 'uncommon', collection: 'cosmic', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Solar Flare Bun', alignment: 'cosmic', rarity: 'rare', collection: 'cosmic', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Nebula Spinner', alignment: 'cosmic', rarity: 'rare', collection: 'cosmic', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Ice Comet Wolf', alignment: 'cosmic', rarity: 'legendary', collection: 'cosmic', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.1, ...statsFor('legendary') },
  { id: id(), name: 'Radio Core', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Draconic Nova', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Pixel Star', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Cestial Moth', alignment: 'cosmic', rarity: 'common', collection: 'cosmic', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Aurora-X', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Voltfox', alignment: 'dark', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Crystalune', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Blazepup', alignment: 'dark', rarity: 'rare', collection: 'wildcard', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Tideclaw', alignment: 'light', rarity: 'rare', collection: 'wildcard', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Shadowkit', alignment: 'dark', rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.1, ...statsFor('legendary') },
  { id: id(), name: 'Gearbee', alignment: 'light', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Nullbit', alignment: 'dark', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Lumifern', alignment: 'light', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Riftwalker', alignment: 'dark', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Stormwing', alignment: 'light', rarity: 'uncommon', collection: 'nature', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Irontoad', alignment: 'dark', rarity: 'uncommon', collection: 'nature', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Phantomcat', alignment: 'light', rarity: 'uncommon', collection: 'wildcard', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 1.0, ...statsFor('uncommon') },
  { id: id(), name: 'Solarbolt', alignment: 'dark', rarity: 'rare', collection: 'wildcard', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Venomspinner', alignment: 'light', rarity: 'rare', collection: 'wildcard', baseCaptureRate: 0.2, baseCrystalRate: 8, spawnWeight: 0.375, ...statsFor('rare') },
  { id: id(), name: 'Frostbyte-X', alignment: 'dark', rarity: 'legendary', collection: 'wildcard', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0.1, ...statsFor('legendary') },
  { id: id(), name: 'Echocore', alignment: 'light', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Dragonscale', alignment: 'dark', rarity: 'common', collection: 'mythical', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Pixelshade', alignment: 'light', rarity: 'common', collection: 'wildcard', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },
  { id: id(), name: 'Celestia', alignment: 'dark', rarity: 'common', collection: 'nature', baseCaptureRate: 0.7, baseCrystalRate: 1, spawnWeight: 2.0, ...statsFor('common') },

  // -- Superhero Event collection. Event-only (spawnWeight: 0 baseline,
  // only appears via the 2-hour grant-mode event). 15 usable designs
  // from the uploaded sheet, rarity/alignment assigned by us based on
  // each design's look — open to adjusting once you've seen them live.
  { id: id(), name: 'Mightron',      alignment: 'dark',  rarity: 'common',    collection: 'superhero', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, eventOnly: true, ...statsFor('common') },
  { id: id(), name: 'Velocity',      alignment: 'light', rarity: 'common',    collection: 'superhero', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, eventOnly: true, ...statsFor('common') },
  { id: id(), name: 'Stingray',      alignment: 'light', rarity: 'common',    collection: 'superhero', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, eventOnly: true, ...statsFor('common') },
  { id: id(), name: 'Terrabolt',     alignment: 'dark',  rarity: 'common',    collection: 'superhero', baseCaptureRate: 0.70, baseCrystalRate: 1,  spawnWeight: 0, eventOnly: true, ...statsFor('common') },
  { id: id(), name: 'Pixielight',    alignment: 'light', rarity: 'uncommon',  collection: 'superhero', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, eventOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Night Sentinel',alignment: 'dark',  rarity: 'uncommon',  collection: 'superhero', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, eventOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Frostblaze',    alignment: 'light', rarity: 'uncommon',  collection: 'superhero', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, eventOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Skylite',       alignment: 'light', rarity: 'uncommon',  collection: 'superhero', baseCaptureRate: 0.45, baseCrystalRate: 3,  spawnWeight: 0, eventOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Orbital Mage',  alignment: 'light', rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Luminova',      alignment: 'light', rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Crimson Edge',  alignment: 'dark',  rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Solaris Guard', alignment: 'light', rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Cyberwraith',   alignment: 'dark',  rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Cosmion',       alignment: 'cosmic',rarity: 'legendary', collection: 'superhero', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },
  { id: id(), name: 'Aquawave',      alignment: 'light', rarity: 'legendary', collection: 'superhero', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },

  // -- The 5 flagged designs — species entries only, no usable art yet.
  // Names kept exactly as given; will use the standard image fallback
  // (procedural icon) until real artwork replaces the current designs.
  { id: id(), name: 'Patriotix',   alignment: 'light', rarity: 'legendary', collection: 'superhero', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },
  { id: id(), name: 'Webstriker',  alignment: 'dark',  rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Thunderion',  alignment: 'light', rarity: 'legendary', collection: 'superhero', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },
  { id: id(), name: 'Shadowclaw',  alignment: 'dark',  rarity: 'legendary', collection: 'superhero', baseCaptureRate: 0.05, baseCrystalRate: 20, spawnWeight: 0, eventOnly: true, ...statsFor('legendary') },
  { id: id(), name: 'Iron Ascent', alignment: 'light', rarity: 'rare',      collection: 'superhero', baseCaptureRate: 0.20, baseCrystalRate: 8,  spawnWeight: 0, eventOnly: true, ...statsFor('rare') },

  // -- Scaffitan (the Titan). Never wild-spawnable — obtained only via
  // a rare chance after winning a Titan battle. Masters through tiers
  // by spending Energy Tubes (see SCAFFITAN_MASTERY_TABLE below), a
  // separate progression axis from normal leveling, which it also does.
  // Distinct names per tier so each of the 5 confirmed PNGs maps to a
  // real, separate image slug.
  { id: id(), name: 'Scaffitan',          alignment: 'cosmic', rarity: 'common',    collection: 'titan', baseCaptureRate: 0.03, baseCrystalRate: 5,  spawnWeight: 0, ...statsFor('common') },
  { id: id(), name: 'Scaffitan Prime',     alignment: 'cosmic', rarity: 'uncommon',  collection: 'titan', baseCaptureRate: 1, baseCrystalRate: 10, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('uncommon') },
  { id: id(), name: 'Scaffitan Ascendant', alignment: 'cosmic', rarity: 'rare',      collection: 'titan', baseCaptureRate: 1, baseCrystalRate: 20, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('rare') },
  { id: id(), name: 'Scaffitan Apex',      alignment: 'cosmic', rarity: 'legendary', collection: 'titan', baseCaptureRate: 1, baseCrystalRate: 35, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('legendary') },
  { id: id(), name: 'Scaffitan Eternal',   alignment: 'cosmic', rarity: 'galactic',  collection: 'titan', baseCaptureRate: 1, baseCrystalRate: 60, spawnWeight: 0, isEvolutionOnly: true, isGalactic: true, galacticBuffType: 'hp_boost', galacticBuffPercent: 20, ...statsFor('galactic') },

  // ---- APEX (30) ----
  // The endgame set. Every one of these has spawnWeight 0, exactly like
  // the Solar/Summer collection: they NEVER appear on a normal sweep. The
  // only way one exists in the world is an active grant-mode Apex Hunt
  // event (see createApexHuntEvent below), which is why there's no
  // day/night, weekday or collection window logic here — the event IS the
  // window.
  //
  // baseCaptureRate 0.02 is the lowest in the game by a wide margin
  // (Scaffitan, the previous floor, is 0.03). Combined with the narrowest
  // minigame zone and the fastest marker, an Apex should feel like
  // something you mostly fail to catch.
  //
  // Alignments are split evenly light/dark so Apex works with the
  // existing alignment-based buffs, art tinting and marker colours
  // without any special-casing.
  { id: id(), name: 'Voltrix',      alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Chronobot',    alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Gravitus',     alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Mutatron',     alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Forgeback',    alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Orbitron',     alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Magnetor',     alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Mirrord',      alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Synaptix',     alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Mythron',      alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Verdant-01',   alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Specter-7',    alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Jestrix',      alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Corsair-X',    alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Frostbyte',    alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Heliarch',     alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Scrapjack',    alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Nurturon',     alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Assembler-X',  alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Evolux',       alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Reflector',    alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Null',         alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Lunaris',      alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Cometron',     alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Omen',         alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Sonatron',     alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Polaris',      alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Furnace',      alignment: 'dark',  rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Tidal-X',      alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
  { id: id(), name: 'Regent',       alignment: 'light', rarity: 'apex', collection: 'apex', baseCaptureRate: 0.02, baseCrystalRate: 120, spawnWeight: 0, isApex: true, ...statsFor('apex') },
];

// Leafkin -> Bushy is the first (and template) evolution pair. Keyed by
// species id so adding more pairs later is pure data, not new code.
const leafkinSpecies = droidSpecies.find((s) => s.name === 'Leafkin');
const bushySpecies = droidSpecies.find((s) => s.name === 'Bushy');
const shamblerSpecies = droidSpecies.find((s) => s.name === 'Shambler');
const walkerSpecies = droidSpecies.find((s) => s.name === 'Walker');
const corruptorSpecies = droidSpecies.find((s) => s.name === 'Corruptor');
const voidsovereignSpecies = droidSpecies.find((s) => s.name === 'Voidsovereign');
const illumeSpecies = droidSpecies.find((s) => s.name === 'Illume');
const lumenguardSpecies = droidSpecies.find((s) => s.name === 'Lumenguard');
const luminorSpecies = droidSpecies.find((s) => s.name === 'Luminor');
const luminarchSpecies = droidSpecies.find((s) => s.name === 'Luminarch');
const EVOLUTION_TABLE = {
  [leafkinSpecies.id]: { evolvesTo: bushySpecies.id, novaChipCost: 15 },
  // Full 4-tier chains: only Common is wild-spawnable in these two
  // lines — Uncommon/Rare/Legendary are ALL evolution-only now.
  [shamblerSpecies.id]: { evolvesTo: walkerSpecies.id, novaChipCost: 15 },
  // Deliberate cross-alignment design: the Dark line's final evolution
  // needs a LIGHT material, and vice versa — not a typo.
  [walkerSpecies.id]: { evolvesTo: corruptorSpecies.id, novaChipCost: 25, extraCrystalCost: 1000, extraMaterials: [{ key: 'zombieJuice', cost: 5 }] },
  [corruptorSpecies.id]: { evolvesTo: voidlordSpeciesId(), novaChipCost: 40, extraMaterials: [{ key: 'lightStones', cost: 1 }, { key: 'zombieJuice', cost: 15 }] },
  // New 5th tier — Cosmic cap. Numbers are our own placeholder escalation
  // (60 Nova Chips, 2000 crystals) until you confirm real figures.
  [voidlordSpeciesId()]: { evolvesTo: voidsovereignSpecies.id, novaChipCost: 60, extraCrystalCost: 2000, extraMaterials: [{ key: 'zombieJuice', cost: 25 }] },
  [illumeSpecies.id]: { evolvesTo: lumenguardSpecies.id, novaChipCost: 15 },
  [lumenguardSpecies.id]: { evolvesTo: luminorSpecies.id, novaChipCost: 25, extraCrystalCost: 1000, extraMaterials: [{ key: 'lumeCells', cost: 5 }] },
  [luminorSpecies.id]: { evolvesTo: luxionSpeciesId(), novaChipCost: 40, extraMaterials: [{ key: 'darkCrystals', cost: 1 }, { key: 'lumeCells', cost: 15 }] },
  // New 5th tier — Cosmic cap, mirrors the Zombie line's placeholder numbers.
  [luxionSpeciesId()]: { evolvesTo: luminarchSpecies.id, novaChipCost: 60, extraCrystalCost: 2000, extraMaterials: [{ key: 'lumeCells', cost: 25 }] },
};
function voidlordSpeciesId() { return droidSpecies.find((s) => s.name === 'Voidlord').id; }

// Scaffitan's mastery progression — spends Energy Tubes, not Nova
// Chips, so it's a deliberately separate table from EVOLUTION_TABLE
// rather than overloading that system with a second resource type.
const scaffitanSpecies = droidSpecies.find((s) => s.name === 'Scaffitan');
const scaffitanPrimeSpecies = droidSpecies.find((s) => s.name === 'Scaffitan Prime');
const scaffitanAscendantSpecies = droidSpecies.find((s) => s.name === 'Scaffitan Ascendant');
const scaffitanApexSpecies = droidSpecies.find((s) => s.name === 'Scaffitan Apex');
const scaffitanEternalSpecies = droidSpecies.find((s) => s.name === 'Scaffitan Eternal');
const SCAFFITAN_MASTERY_TABLE = {
  [scaffitanSpecies.id]: { masterTo: scaffitanPrimeSpecies.id, tubeCost: 15 },
  [scaffitanPrimeSpecies.id]: { masterTo: scaffitanAscendantSpecies.id, tubeCost: 40 },
  [scaffitanAscendantSpecies.id]: { masterTo: scaffitanApexSpecies.id, tubeCost: 75 },
  [scaffitanApexSpecies.id]: { masterTo: scaffitanEternalSpecies.id, tubeCost: 150 },
};
function luxionSpeciesId() { return droidSpecies.find((s) => s.name === 'Luxion').id; }

const RARITY_TTL_MS = {
  common: 15 * 60 * 1000,
  uncommon: 10 * 60 * 1000,
  rare: 8 * 60 * 1000,
  legendary: 5 * 60 * 1000,
  cosmic: 4 * 60 * 1000,
  galactic: 4 * 60 * 1000, // was missing entirely — never hit in practice because Scaffitan Eternal is evolution-only, but it made this table lie about its coverage
  apex: 3 * 60 * 1000,     // shortest window of any tier: find it fast or lose it
};

const RARITY_MAX_PER_CELL = {
  common: 6, // raised from 3 — needed headroom for a dense nearby scan (see spawns.js generation)
  uncommon: 3, // raised from 2
  rare: 1,
  legendary: 1,
  cosmic: 1,
  galactic: 1,
  apex: 1,
};

const LEGENDARY_CITY_CAP = 3;
const COSMIC_CITY_CAP = 1; // StarSprite — only one active anywhere at a time
const APEX_CITY_CAP = 3;   // up to three Apex live worldwide at once during a Hunt — raised from 1 so a small beta group actually encounters them

// ---- crystal power requirement ----
// The control pad literally needs crystals to function (per the original
// pitch) — below this, an attempt is rejected outright rather than just
// having low odds. Scales with rarity: tougher droids need more power.
const RELEASE_REFUND_MULTIPLIER = 1.5; // shared between workshop.js (normal release) and capture.js (auto-release-duplicates)
const MIN_CRYSTAL_COST = {
  common: 1,
  uncommon: 5,
  rare: 15,
  legendary: 40,
  cosmic: 80,
  galactic: 120,
  // Apex sits deliberately BETWEEN rare (15) and legendary (40) — the
  // difficulty is meant to come from the minigame and the capture rate,
  // not from pricing players out of attempting one at all.
  apex: 25,
};

// +5% of base minimum capture cost per Pad Level — a deliberate crystal
// sink so upgrading the pad doesn't just let crystals pile up unused.
// Shared between capture.js (enforcement) and spawns.js (so the client
// sees the real cost up front, not the stale unscaled base number).
const PAD_LEVEL_COST_SCALING = 0.05;
function scaledMinCrystalCost(rarity, padLevel) {
  return Math.round(MIN_CRYSTAL_COST[rarity] * (1 + PAD_LEVEL_COST_SCALING * padLevel));
}

// ---- variants (shiny-equivalent) ----
// Rolled independently of species/rarity — any droid, even a Common one, can
// come up Platinum or Rusty. Keeps every spawn worth a second look, not just
// the already-rare ones.
//
// TESTING_HIGH_VARIANT_ODDS: flip to false before launch. True makes variants
// common (80% combined) purely so you can visually confirm both render
// correctly without grinding for a 1-in-1000 chance.
const TESTING_HIGH_VARIANT_ODDS = false; // flipped off — confirmed with the team, live odds are now the intended 1/1000 production rate

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
const PRIMARY_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

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
  galactic: 6,
  apex: 8,
};
function levelUpCost(currentLevel, rarity = 'common') {
  const multiplier = RARITY_LEVEL_COST_MULTIPLIER[rarity] ?? 1;
  return Math.round(10 * Math.pow(currentLevel, 1.6) * multiplier);
}

// ---- Apex Cubes ----
// Apex droids level on Cubes, not crystals — a completely separate
// currency, so crystal wealth alone can't fast-track the endgame set.
// Same curve shape as levelUpCost above (10 * level^1.6) but with its own
// multiplier, tuned so level 1 -> 2 costs exactly the confirmed 10 cubes.
const APEX_CUBE_LEVEL_MULTIPLIER = 1;
const APEX_CUBE_MIN_DROP = 1;
const APEX_CUBE_MAX_DROP = 5;

function apexCubeLevelUpCost(currentLevel) {
  return Math.round(10 * Math.pow(currentLevel, 1.6) * APEX_CUBE_LEVEL_MULTIPLIER);
}

// Every Apex interaction drops cubes — capture, defeat in battle, or
// release. Never zero: an Apex encounter is rare enough that walking away
// empty-handed would feel punishing rather than exciting.
function rollApexCubeDrop() {
  return APEX_CUBE_MIN_DROP + Math.floor(Math.random() * (APEX_CUBE_MAX_DROP - APEX_CUBE_MIN_DROP + 1));
}

function isApexSpecies(species) {
  return Boolean(species && species.rarity === 'apex');
}

// ---- pad upgrades (crystals -> account-wide capture power) ----
// Separate progression track from droid leveling: this upgrades the
// control pad itself, not any one droid. Two effects: a small chance per
// attempt of a guaranteed "critical capture", and a slightly higher
// ceiling on the accuracy-skill multiplier.
const PAD_CRIT_BASE = 0.02;        // 2% crit chance at pad level 0
const PAD_CRIT_PER_LEVEL = 0.005;  // +0.5% per level — recalibrated down from 1%, applies live to all existing players (this is computed fresh each time, never stored)
const PAD_CRIT_CAP = 0.50;         // never exceeds 50% — keep crystal power meaningful
const PAD_SKILL_CEILING_PER_LEVEL = 0.01; // padSkillMultiplier ceiling nudges up slightly per level
// Escalating tiers after level 10 and 20 — costs jump meaningfully at
// each threshold, not just the smooth power-curve growth from before.
function padUpgradeCost(currentPadLevel) {
  const base = 100 * Math.pow(currentPadLevel + 1, 1.7);
  let tierMultiplier = 1;
  if (currentPadLevel >= 20) tierMultiplier = 3;
  else if (currentPadLevel >= 10) tierMultiplier = 1.75;
  return Math.round(base * tierMultiplier);
}
// Every 5th level (5, 10, 15...) also needs 1 Pad RAM, on top of the
// crystal cost — a real wall against rapid-fire leveling.
function padRequiresRam(nextPadLevel) {
  return nextPadLevel % 5 === 0;
}
function critChanceForPadLevel(padLevel) {
  return Math.min(PAD_CRIT_CAP, PAD_CRIT_BASE + PAD_CRIT_PER_LEVEL * padLevel);
}

// ---- time-exclusive events ----
// An event boosts spawn weight for a set of species (or a whole
// collection) for a fixed time window. Generalizes the same multiplier
// pattern the day/night alignment bias already uses in spawns.js.
const events = new Map(); // id -> event row
const posterReactions = new Map(); // filename -> { likes: 0, dislikes: 0, reactedBy: { playerId: 'like'|'dislike' } }

function reactToPoster(playerId, filename, reaction) {
  if (!['like', 'dislike'].includes(reaction)) throw new Error('Reaction must be like or dislike');
  if (!posterReactions.has(filename)) posterReactions.set(filename, { likes: 0, dislikes: 0, reactedBy: {} });
  const row = posterReactions.get(filename);
  const previous = row.reactedBy[playerId];
  if (previous === reaction) {
    // tapping the same reaction again removes it — a real toggle, not a one-way lock
    row[previous === 'like' ? 'likes' : 'dislikes'] -= 1;
    delete row.reactedBy[playerId];
  } else {
    if (previous) row[previous === 'like' ? 'likes' : 'dislikes'] -= 1;
    row[reaction === 'like' ? 'likes' : 'dislikes'] += 1;
    row.reactedBy[playerId] = reaction;
  }
  return { likes: row.likes, dislikes: row.dislikes, yourReaction: row.reactedBy[playerId] || null };
}

function getPosterReactions(filename, playerId = null) {
  const row = posterReactions.get(filename) || { likes: 0, dislikes: 0, reactedBy: {} };
  return { likes: row.likes, dislikes: row.dislikes, yourReaction: playerId ? (row.reactedBy[playerId] || null) : null };
}

function dismissPoster(playerId, filename) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!player.dismissedPosters) player.dismissedPosters = [];
  if (!player.dismissedPosters.includes(filename)) player.dismissedPosters.push(filename);
  return { dismissedPosters: player.dismissedPosters };
}

const EVENT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const lastEventLaunchByTarget = new Map(); // targetKey -> timestamp

function eventTargetKey({ speciesIds = [], collection = null, rarity = null }) {
  if (collection) return `collection:${collection}`;
  if (rarity) return `rarity:${rarity}`;
  return `species:${[...speciesIds].sort().join(',')}`;
}

// Per-rarity spawn weight granted to Solar-collection species while a
// "grant" event targeting them is active — mirrors the internal
// common/uncommon/rare/legendary proportions the Mythical/Nature
// collections already use (15 / 6.25 / 3 / 0.75), so Summer feels
// consistent with the base spawn rates once it's live.
const SOLAR_GRANT_WEIGHT_BY_RARITY = { common: 15, uncommon: 6.25, rare: 3, legendary: 0.75 };

function createEvent({ name, mode = 'boost', speciesIds = [], collection = null, rarity = null, spawnWeightMultiplier = 2, grantWeights = null, startTime, endTime, cooldownMs = null }) {
  const targetKey = eventTargetKey({ speciesIds, collection, rarity });
  const effectiveCooldown = cooldownMs != null ? cooldownMs : EVENT_COOLDOWN_MS;
  const lastLaunch = lastEventLaunchByTarget.get(targetKey);
  if (lastLaunch && Date.now() - lastLaunch < effectiveCooldown) {
    const remainingMs = effectiveCooldown - (Date.now() - lastLaunch);
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
    collection,   // 'mythical' | 'nature' — targets every species in that collection (boost mode only), OR
    rarity,       // 'common' | 'uncommon' | 'rare' | 'legendary' | 'cosmic' — targets every species of that rarity (boost mode only)
    spawnWeightMultiplier,
    grantWeights: resolvedGrantWeights, // { speciesId: weight } — grant mode only
    startTime,
    endTime,
    cooldownMs: effectiveCooldown, // stored so listActiveEvents/UI can show the right cooldown for THIS event's target
  };
  events.set(event.id, event);
  lastEventLaunchByTarget.set(targetKey, Date.now());
  return event;
}

function listActiveEvents(now = Date.now()) {
  return [...events.values()].filter((e) => now >= e.startTime && now <= e.endTime);
}

// ---- Apex Hunt ----
// The one and only way Apex droids enter the world. Uses the existing
// grant-mode machinery: Apex species carry spawnWeight 0 permanently, and
// this event adds a real (tiny) weight for its duration only. When it
// ends they drop back to 0 automatically — no cleanup pass needed.
//
// APEX_HUNT_GRANT_WEIGHT is per-species. With 30 species at 0.35 each the
// combined Apex weight is ~10.5 against a normal-tier total of ~100, and
// the RARITY_MAX_PER_CELL / APEX_CITY_CAP limits of 1 keep the actual
// number that materialise far lower than that ratio suggests.
const APEX_HUNT_DURATION_MS = 30 * 60 * 1000; // 30 minutes, as specified
const APEX_HUNT_GRANT_WEIGHT = 0.35;
const APEX_HUNT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h between hunts

function apexSpeciesList() {
  return droidSpecies.filter((s) => s.rarity === 'apex');
}

function createApexHuntEvent({ durationMs = APEX_HUNT_DURATION_MS } = {}) {
  const apex = apexSpeciesList();
  if (!apex.length) throw new Error('No Apex species defined');
  const grantWeights = {};
  apex.forEach((s) => { grantWeights[s.id] = APEX_HUNT_GRANT_WEIGHT; });
  const now = Date.now();
  return createEvent({
    name: 'Apex Hunt',
    mode: 'grant',
    speciesIds: apex.map((s) => s.id),
    grantWeights,
    startTime: now,
    endTime: now + durationMs,
    cooldownMs: APEX_HUNT_COOLDOWN_MS,
  });
}

function isApexHuntActive(now = Date.now()) {
  return listActiveEvents(now).some((e) => e.name === 'Apex Hunt');
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
      (event.collection && event.collection === species.collection) ||
      (event.rarity && event.rarity === species.rarity);
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
// gives two independent timers you can stagger. StarSprite now needs
// activation too (2hr active, vs Nebulfox/Enforcer's 1hr) — every
// companion type requires activation now, none stay "always-on."
const ACTIVATED_BUFF_DURATION_MS = 60 * 60 * 1000; // fallback default if a species doesn't specify its own
const ACTIVATED_BUFF_COOLDOWN_MS = 8 * 60 * 60 * 1000; // uniform 8 hours after it ends, before that droid can reactivate
const ACTIVATED_BUFF_TYPES = ['capture_rate', 'damage', 'crystal'];

function activateCompanionBuff(playerId, droidId) {
  const player = players.get(playerId);
  const droid = ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  const species = droidSpecies.find((s) => s.id === droid.speciesId);
  if (!species || !species.isCompanion || !ACTIVATED_BUFF_TYPES.includes(species.companionBuffType)) {
    throw new Error('This companion type doesn\'t need activating');
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

  const durationMs = species.companionBuffDurationMs || ACTIVATED_BUFF_DURATION_MS;
  droid.buffActiveUntil = now + durationMs;
  droid.buffCooldownUntil = droid.buffActiveUntil + ACTIVATED_BUFF_COOLDOWN_MS;
  return { buffActiveUntil: droid.buffActiveUntil, buffCooldownUntil: droid.buffCooldownUntil };
}

// ---- cosmetics ----
// Purely cosmetic, no gameplay effect — crystal sinks for players who've
// maxed out the practical stuff. Extensible catalog; just one item for
// this beta round.
const COSMETICS_CATALOG = [
  { id: 'beta_crown', name: 'Beta Crown', cost: 1000, description: 'No effect - just shows you were here for the beta.', slot: 'head', rarity: 'legendary' },
];

// ---- Shop ----
// Every material except crystals is buyable here, at a deliberately
// heavy price — meant to reward players who can farm large crystal
// amounts, not to be a cheap shortcut around Depot/Factory/capturing.
// Extensible: new materials (e.g. from a future Battles system) just
// need a new catalog entry, no structural change.
// Single source of truth for every material that can be traded. Add a
// new material here once and it automatically appears in the Trade
// dropdown and becomes tradeable — no other file needs to change.
const TRADEABLE_MATERIALS = [
  { key: 'paint', name: 'Paint' },
  { key: 'novaChips', name: 'Nova Chips' },
  { key: 'beacons', name: 'Beacons' },
  { key: 'augmentCores', name: 'Augment Cores' },
  { key: 'lightStones', name: 'Light Stones' },
  { key: 'darkCrystals', name: 'Dark Crystals' },
  { key: 'padRam', name: 'Pad RAM' },
  { key: 'repairKits', name: 'Repair Kits' },
  { key: 'timeWarps', name: 'Time Warps' },
  { key: 'growths', name: 'Growths' },
  { key: 'energyTubes', name: 'Energy Tubes' },
  { key: 'zombieJuice', name: 'Zombie Juice' },
  { key: 'lumeCells', name: 'Lume Cells' },
  { key: 'apexCubes', name: 'Apex Cubes' },
  { key: 'titanTokens', name: 'Titan Tokens' },
  { key: 'guildTokens', name: 'Guild Tokens' },
  { key: 'joyCoins', name: 'Joy Coins' },
];

const SHOP_CATALOG = [
  { id: 'paint', name: 'Paint', cost: 150, type: 'material', grants: { paint: 1 } },
  { id: 'nova_chip', name: 'Nova Chip', cost: 250, type: 'material', grants: { novaChips: 1 } },
  { id: 'beacon', name: 'Beacon', cost: 300, type: 'material', grants: { beacons: 1 } },
  { id: 'augment_core', name: 'Augment Core', cost: 400, type: 'material', grants: { augmentCores: 1 } },
  { id: 'light_stone', name: 'Light Stone', cost: 500000, type: 'material', grants: { lightStones: 1 } },
  { id: 'dark_crystal', name: 'Dark Crystal', cost: 500000, type: 'material', grants: { darkCrystals: 1 } },
  // Pad RAM's real intended source is a PVE Battle drop (5% chance) —
  // Battles don't exist yet, so Shop is the only way to get one for
  // now. Keep this entry once Battles ship; don't remove it, just stop
  // it being the *only* source.
  { id: 'pad_ram', name: 'Pad RAM', cost: 5000, type: 'material', grants: { padRam: 1 } },
  // Repair Kit's real intended source is Titan battle rewards — not
  // built yet. Shop is a stopgap, same reasoning as Pad RAM above.
  { id: 'repair_kit', name: 'Repair Kit', cost: 1000, type: 'material', grants: { repairKits: 1 } },
  { id: 'time_warp', name: 'Time Warp', cost: 100, type: 'material', grants: { timeWarps: 1 } },
  { id: 'growth', name: 'Growth', cost: 100, type: 'material', grants: { growths: 1 } },
  { id: 'outfit_earthy', name: 'Earthy Outfit', cost: 5000, type: 'outfit', outfitId: 'earthy' },
  { id: 'outfit_technology', name: 'Technology Outfit', cost: 5000, type: 'outfit', outfitId: 'technology' },
  { id: 'outfit_wildlife', name: 'Wildlife Outfit', cost: 5000, type: 'outfit', outfitId: 'wildlife' },
  { id: 'outfit_funky', name: 'Funky Outfit', cost: 5000, type: 'outfit', outfitId: 'funky' },

  // ---- Tokens (1,000,000 crystals each) ----
  // Deliberately the most expensive things in the game — a hard crystal
  // sink aimed at players sitting on huge unspent balances.
  //
  // The shop is the EXPENSIVE fallback, not the intended source: Titan
  // Tokens are meant to drop from Titan encounters and Guild Tokens from
  // guild activity. Those earn routes aren't wired up yet, so right now
  // the shop is the only way to get one — same stopgap situation as Pad
  // RAM and Repair Kits above. Keep these entries when the drops ship;
  // just stop them being the only source.
  { id: 'titan_token', name: 'Titan Token', cost: 1000000, type: 'material', grants: { titanTokens: 1 } },
  { id: 'guild_token', name: 'Guild Token', cost: 1000000, type: 'material', grants: { guildTokens: 1 } },
  { id: 'joy_coin', name: 'Joy Coin', cost: 1000000, type: 'material', grants: { joyCoins: 1 } },
];

// All-or-nothing: validates every item and the combined total cost
// BEFORE deducting anything, so a basket never partially completes —
// either the whole thing goes through, or nothing does.
function buyShopBasket(playerId, items) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!Array.isArray(items) || !items.length) throw new Error('Basket is empty');

  const resolved = items.map(({ itemId, quantity }) => {
    const item = SHOP_CATALOG.find((i) => i.id === itemId);
    if (!item) throw new Error(`Unknown item: ${itemId}`);
    if (item.type === 'outfit' && player.ownedOutfits.includes(item.outfitId)) {
      throw new Error(`Already own ${item.name}`);
    }
    const qty = item.type === 'outfit' ? 1 : Math.max(1, Math.floor(quantity || 1));
    return { item, qty, lineCost: item.cost * qty };
  });

  const totalCost = resolved.reduce((sum, r) => sum + r.lineCost, 0);
  if (player.crystalBalance < totalCost) {
    throw new Error(`Not enough crystals — basket costs ${totalCost}, you have ${Math.floor(player.crystalBalance)}`);
  }

  player.crystalBalance -= totalCost;
  crystalTransactions.push({ id: id(), playerId, amount: -totalCost, source: 'shop_basket_purchase', createdAt: Date.now() });

  resolved.forEach(({ item, qty }) => {
    if (item.type === 'material') {
      if (item.grants.paint) player.paint += item.grants.paint * qty;
      if (item.grants.novaChips) player.novaChips += item.grants.novaChips * qty;
      if (item.grants.beacons) player.beacons += item.grants.beacons * qty;
      if (item.grants.augmentCores) player.augmentCores += item.grants.augmentCores * qty;
      if (item.grants.timeWarps) player.timeWarps += item.grants.timeWarps * qty;
      if (item.grants.growths) player.growths += item.grants.growths * qty;
      if (item.grants.lightStones) player.lightStones += item.grants.lightStones * qty;
      if (item.grants.darkCrystals) player.darkCrystals += item.grants.darkCrystals * qty;
      if (item.grants.padRam) player.padRam += item.grants.padRam * qty;
      if (item.grants.repairKits) player.repairKits += item.grants.repairKits * qty;
    } else if (item.type === 'outfit') {
      player.ownedOutfits.push(item.outfitId);
    }
  });

  return {
    itemsBought: resolved.map((r) => ({ name: r.item.name, quantity: r.qty, cost: r.lineCost })),
    totalCost,
    crystalBalance: player.crystalBalance,
  };
}

function buyShopItem(playerId, itemId, quantity = 1) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  const item = SHOP_CATALOG.find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found');
  if (item.type === 'outfit' && player.ownedOutfits.includes(item.outfitId)) {
    throw new Error('You already own this outfit');
  }
  const qty = item.type === 'outfit' ? 1 : Math.max(1, Math.floor(quantity)); // outfits are one-time, quantity is meaningless for them
  const totalCost = item.cost * qty;
  if (player.crystalBalance < totalCost) throw new Error(`Not enough crystals — ${qty > 1 ? qty + 'x ' : ''}${item.name} costs ${totalCost}`);

  player.crystalBalance -= totalCost;
  crystalTransactions.push({ id: id(), playerId, amount: -totalCost, source: 'shop_purchase', createdAt: Date.now() });

  if (item.type === 'material') {
    if (item.grants.paint) player.paint += item.grants.paint * qty;
    if (item.grants.novaChips) player.novaChips += item.grants.novaChips * qty;
    if (item.grants.beacons) player.beacons += item.grants.beacons * qty;
    if (item.grants.augmentCores) player.augmentCores += item.grants.augmentCores * qty;
    if (item.grants.timeWarps) player.timeWarps += item.grants.timeWarps * qty;
    if (item.grants.growths) player.growths += item.grants.growths * qty;
    if (item.grants.lightStones) player.lightStones += item.grants.lightStones * qty;
    if (item.grants.darkCrystals) player.darkCrystals += item.grants.darkCrystals * qty;
    if (item.grants.padRam) player.padRam += item.grants.padRam * qty;
    if (item.grants.repairKits) player.repairKits += item.grants.repairKits * qty;
  } else if (item.type === 'outfit') {
    player.ownedOutfits.push(item.outfitId);
  }

  return { item, quantityBought: qty, totalCost, crystalBalance: player.crystalBalance, paint: player.paint, novaChips: player.novaChips, beacons: player.beacons, augmentCores: player.augmentCores, timeWarps: player.timeWarps, growths: player.growths, lightStones: player.lightStones, darkCrystals: player.darkCrystals, ownedOutfits: player.ownedOutfits };
}

// Pad plug-ins (Time Warp, Growth) — single-use, consumed the moment
// applied to a capture attempt, regardless of whether that attempt
// succeeds or fails. The actual visual effect (slower sweep / wider
// zone) is rendered client-side for that one attempt; these functions
// just handle the consume-on-use inventory side.
function useTimeWarp(playerId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.timeWarps < 1) throw new Error('No Time Warps owned — buy one from the Shop');
  player.timeWarps -= 1;
  return { timeWarps: player.timeWarps };
}

function useGrowth(playerId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.growths < 1) throw new Error('No Growths owned — buy one from the Shop');
  player.growths -= 1;
  return { growths: player.growths };
}

function equipOutfit(playerId, outfitId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!player.ownedOutfits.includes(outfitId)) throw new Error('You don\'t own this outfit yet');
  player.outfit = outfitId;
  return { outfit: player.outfit };
}

// ---- Anti-spam: scan rate limiting ----
// Real gap found during review — nothing previously stopped rapid-fire
// scanning (real or GPS-spoofed) from building an unbounded queue of
// unclaimed spawns. A simple per-player minimum interval between scans.
const SCAN_RATE_LIMIT_MS = 2000; // 2 seconds — generous enough for real play, blocks scripted spam

function checkScanRateLimit(playerId) {
  if (!playerId) return; // no playerId passed (older/anonymous calls) — nothing to rate-limit against
  const player = players.get(playerId);
  if (!player) return;
  const now = Date.now();
  if (player.lastScanAt && now - player.lastScanAt < SCAN_RATE_LIMIT_MS) {
    throw new Error('Scanning too fast — slow down a moment');
  }
  player.lastScanAt = now;
}

// ---- Depot ----
// The hourly counterpart to the Factory: no slots, no incubation — every
// attempt succeeds in the sense that you always get SOME reward, but
// minigame accuracy scales how good it is. Paint/Nova Chip odds stay
// flat regardless of skill (only the crystal payout scales), per design.
const DEPOT_MINIGAME_COST = 100; // crystals per attempt
const DEPOT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const DEPOT_BASE_CRYSTAL_REWARD = 50;
const DEPOT_BONUS_CRYSTAL_RANGE = 150; // total payout ranges 50-200 depending on closeness
const DEPOT_PAINT_CHANCE = 0.12; // was 0.15 — trimmed slightly to make room for Augment Core
const DEPOT_NOVA_CHIP_CHANCE = 0.12; // was 0.15
const DEPOT_AUGMENT_CORE_CHANCE = 0.10;

function attemptDepot(playerId, closeness, attemptDurationMs) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');

  const now = Date.now();
  if (player.depotCooldownUntil && now < player.depotCooldownUntil) {
    const minsLeft = Math.ceil((player.depotCooldownUntil - now) / 60000);
    throw new Error(`Depot is on cooldown for another ~${minsLeft}m`);
  }
  if (attemptDurationMs < 200) throw new Error('Attempt rejected: implausible timing');
  if (player.crystalBalance < DEPOT_MINIGAME_COST) {
    throw new Error(`Not enough crystals — visiting the Depot costs ${DEPOT_MINIGAME_COST}`);
  }

  const clampedCloseness = Math.max(0, Math.min(1, closeness));
  player.crystalBalance -= DEPOT_MINIGAME_COST;
  const crystalsEarned = Math.round(DEPOT_BASE_CRYSTAL_REWARD + clampedCloseness * DEPOT_BONUS_CRYSTAL_RANGE);
  player.crystalBalance += crystalsEarned;
  crystalTransactions.push({ id: id(), playerId, amount: crystalsEarned - DEPOT_MINIGAME_COST, source: 'depot_visit', createdAt: now });

  const gotPaint = Math.random() < DEPOT_PAINT_CHANCE;
  if (gotPaint) player.paint += 1;
  const gotNovaChip = Math.random() < DEPOT_NOVA_CHIP_CHANCE;
  if (gotNovaChip) player.novaChips += 1;
  const gotAugmentCore = Math.random() < DEPOT_AUGMENT_CORE_CHANCE;
  if (gotAugmentCore) player.augmentCores += 1;

  player.depotCooldownUntil = now + DEPOT_COOLDOWN_MS;

  return {
    crystalsEarned,
    gotPaint,
    gotNovaChip,
    gotAugmentCore,
    crystalBalance: player.crystalBalance,
    paint: player.paint,
    novaChips: player.novaChips,
    augmentCores: player.augmentCores,
    depotCooldownUntil: player.depotCooldownUntil,
  };
}

// ---- Beacons ----
// A consumable: activating one gives the holder a temporary boost to
// rarer-tier spawn weight specifically at the moment THEY trigger new
// spawn generation nearby (the existing lazy per-cell spawn job). Since
// spawns are shared once created, anyone else scanning that same cell
// benefits too — a beacon is a visible signal, not a private advantage.
const BEACON_COST = 300; // crystals to buy one
const BEACON_DURATION_MS = 30 * 60 * 1000; // 30 minutes once activated
const BEACON_BOOST_MULTIPLIER = 3; // applied to rare/legendary/cosmic tier weights only, while active

function buyBeacon(playerId, quantity = 1) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  const qty = Math.max(1, Math.floor(quantity));
  const totalCost = BEACON_COST * qty;
  if (player.crystalBalance < totalCost) throw new Error(`Not enough crystals — ${qty} Beacon${qty > 1 ? 's' : ''} costs ${totalCost}`);
  player.crystalBalance -= totalCost;
  crystalTransactions.push({ id: id(), playerId, amount: -totalCost, source: 'beacon_purchase', createdAt: Date.now() });
  player.beacons += qty;
  return { beacons: player.beacons, crystalBalance: player.crystalBalance, quantityBought: qty, totalCost };
}

function activateBeacon(playerId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  const now = Date.now();
  if (player.beaconActiveUntil && now < player.beaconActiveUntil) throw new Error('A Beacon is already active');
  if (player.beacons < 1) throw new Error('No Beacons owned — buy one first');
  player.beacons -= 1;
  player.beaconActiveUntil = now + BEACON_DURATION_MS;
  return { beacons: player.beacons, beaconActiveUntil: player.beaconActiveUntil };
}

function isBeaconActive(playerId, now = Date.now()) {
  const player = players.get(playerId);
  return !!(player && player.beaconActiveUntil && now < player.beaconActiveUntil);
}

// Cell-level beacon visibility: when a player WITH an active beacon
// scans a cell, that cell gets marked as beacon-boosted until their
// beacon would naturally expire — so someone ELSE scanning the same
// cell shortly after also sees the indicator, not just the beacon
// holder themselves. A beacon is a visible signal, not a private effect.
const beaconBoostedCells = new Map(); // cell -> expiresAt

function markCellBeaconBoosted(cell, expiresAt) {
  const existing = beaconBoostedCells.get(cell);
  if (!existing || expiresAt > existing) beaconBoostedCells.set(cell, expiresAt);
}

function isCellBeaconBoosted(cell, now = Date.now()) {
  const expiresAt = beaconBoostedCells.get(cell);
  return !!(expiresAt && now < expiresAt);
}

// ---- Factory / Prototype (weekly-feel droid hatching) ----
// Two-stage: (1) win an "egg" from the Factory minigame, (2) assign it to
// a Processor slot and pay to start a 20h incubation, (3) collect once
// ready — rolls a fixed rarity table independent of minigame skill.
// Processor slots are bought (like Workshop slots), all 5 locked to
// start — no free starter slot, since this is a bigger commitment than
// farming. The cooldown between minigame attempts (not between slot
// uses) is what makes owning multiple slots matter: slots let you
// incubate several eggs in parallel, the cooldown paces how fast you can
// earn new eggs to fill them.
const PROCESSOR_SLOT_COUNT = 5;
const PROCESSOR_SLOT_COSTS = [500, 1000, 1500, 2000, 2500];
const FACTORY_MINIGAME_COST = 100; // crystals per attempt, win or lose
const FACTORY_START_HATCH_COST = 100; // crystals to assign an egg to a slot and begin incubation
const FACTORY_HATCH_DURATION_MS = 20 * 60 * 60 * 1000; // 20 hours
const FACTORY_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours between minigame attempts (not per-slot)
const CRUSH_NOVA_CHIP_CHANCE = 0.05; // smaller than a normal release's 10% — this is unrealized potential, not a captured droid

const processorSlots = new Map(); // id -> { id, playerId, slotIndex, unlocked, eggId, hatchReadyAt }
const eggs = new Map(); // id -> { id, playerId, createdAt } — unassigned, waiting for a processor

const PROTOTYPE_RARITY_TABLE = [
  { rarity: 'legendary', chance: 0.05 },
  { rarity: 'rare', chance: 0.15 },
  { rarity: 'uncommon', chance: 0.30 },
  { rarity: 'common', chance: 0.4999 },
  { rarity: 'cosmic', chance: 0.0001 },
];

function rollPrototypeRarity() {
  const roll = Math.random();
  let cumulative = 0;
  for (const entry of PROTOTYPE_RARITY_TABLE) {
    cumulative += entry.chance;
    if (roll < cumulative) return entry.rarity;
  }
  return 'common'; // safety fallback, shouldn't hit given the table sums to 1
}

// A species is eligible for a Prototype roll unless it's evolution-only
// (never obtainable except by evolving) or event-exclusive with no
// matching event currently live (so Prototypes can't hand out Solar
// droids outside the Summer Event — that would undercut the whole point
// of them being time-exclusive).
function eligiblePrototypeSpecies(rarity, now = Date.now()) {
  return droidSpecies.filter((s) => {
    if (s.rarity !== rarity) return false;
    if (s.isEvolutionOnly) return false;
    if (s.eventOnly) {
      const hasActiveGrant = listActiveEvents(now).some((e) => e.mode === 'grant' && e.speciesIds && e.speciesIds.includes(s.id));
      if (!hasActiveGrant) return false;
    }
    return true;
  });
}

// ---- guilds ----
// Minimal for now: a name and a member list, no gameplay effect yet -
// foundation for a future PVP/guild system. Small friend-group cap.
const guilds = new Map(); // id -> guild row
const battles = new Map(); // id -> battle row (see battle.js)
const GUILD_MAX_MEMBERS = 12;

function sendFriendRequest(fromPlayerId, toPlayerId) {
  const from = players.get(fromPlayerId);
  const to = players.get(toPlayerId);
  if (!from) throw new Error('Player not found');
  if (!to) throw new Error('That Player ID doesn\'t exist');
  if (fromPlayerId === toPlayerId) throw new Error('Cannot add yourself as a friend');
  if (!from.friends) from.friends = [];
  if (!from.friendRequestsSent) from.friendRequestsSent = [];
  if (!to.friendRequestsReceived) to.friendRequestsReceived = [];
  if (from.friends.includes(toPlayerId)) throw new Error('Already friends');
  if (from.friendRequestsSent.includes(toPlayerId)) throw new Error('Request already sent');
  if (to.friendRequestsReceived && to.friendRequestsReceived.includes(fromPlayerId)) throw new Error('Request already sent');
  from.friendRequestsSent.push(toPlayerId);
  to.friendRequestsReceived.push(fromPlayerId);
  return { sent: true };
}

function acceptFriendRequest(playerId, fromPlayerId) {
  const player = players.get(playerId);
  const from = players.get(fromPlayerId);
  if (!player || !from) throw new Error('Player not found');
  if (!player.friendRequestsReceived || !player.friendRequestsReceived.includes(fromPlayerId)) {
    throw new Error('No pending request from that player');
  }
  player.friendRequestsReceived = player.friendRequestsReceived.filter((id) => id !== fromPlayerId);
  if (from.friendRequestsSent) from.friendRequestsSent = from.friendRequestsSent.filter((id) => id !== playerId);
  if (!player.friends) player.friends = [];
  if (!from.friends) from.friends = [];
  if (!player.friends.includes(fromPlayerId)) player.friends.push(fromPlayerId);
  if (!from.friends.includes(playerId)) from.friends.push(playerId);
  return { friends: player.friends };
}

function declineFriendRequest(playerId, fromPlayerId) {
  const player = players.get(playerId);
  const from = players.get(fromPlayerId);
  if (!player) throw new Error('Player not found');
  if (player.friendRequestsReceived) {
    player.friendRequestsReceived = player.friendRequestsReceived.filter((id) => id !== fromPlayerId);
  }
  if (from && from.friendRequestsSent) {
    from.friendRequestsSent = from.friendRequestsSent.filter((id) => id !== playerId);
  }
  return { declined: true };
}

function getFriendsData(playerId) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  const friendIds = player.friends || [];
  const friends = friendIds.map((id) => {
    const f = players.get(id);
    if (!f) return null;
    const dex = getDex(id);
    return { id, username: f.username, dexCaught: dex.entries.filter((e) => e.caught).length, dexTotal: dex.entries.length };
  }).filter(Boolean);
  // Online / idle / offline dot for each friend.
  const decoratedFriends = presence.decorate(friends);
  const incoming = (player.friendRequestsReceived || []).map((id) => {
    const f = players.get(id);
    return f ? { id, username: f.username } : null;
  }).filter(Boolean);
  return { friends: decoratedFriends, incomingRequests: incoming };
}

const GUILD_KICK_GLOBAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day before joining ANY guild
const GUILD_KICK_SAME_GUILD_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days before rejoining THAT guild

function createGuild(playerId, name) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.guildId) throw new Error('Already in a guild - leave it first');
  const guild = { id: id(), name, creatorId: playerId, memberIds: [playerId], createdAt: Date.now(), badge: null, notice: '' };
  guilds.set(guild.id, guild);
  player.guildId = guild.id;
  return guild;
}

const GUILD_BADGES = ['dark_side', 'light_side']; // sold in the Shop, bought by any member, assigned by the leader

function setGuildBadge(playerId, guildId, badge) {
  const guild = guilds.get(guildId);
  if (!guild) throw new Error('Guild not found');
  if (guild.creatorId !== playerId) throw new Error('Only the guild creator can set the badge');
  if (badge !== null && !GUILD_BADGES.includes(badge)) throw new Error('Invalid badge');
  guild.badge = badge;
  return guild;
}

const GUILD_NOTICE_MAX_LENGTH = 300;

function setGuildNotice(playerId, guildId, notice) {
  const guild = guilds.get(guildId);
  if (!guild) throw new Error('Guild not found');
  if (guild.creatorId !== playerId) throw new Error('Only the guild creator can edit the notice');
  guild.notice = (notice || '').slice(0, GUILD_NOTICE_MAX_LENGTH);
  return guild;
}

const GUILD_BADGE_COST = 5000;

function buyGuildBadge(playerId, guildId, badge) {
  const player = players.get(playerId);
  const guild = guilds.get(guildId);
  if (!player) throw new Error('Player not found');
  if (!guild) throw new Error('Guild not found');
  if (guild.creatorId !== playerId) throw new Error('Only the guild creator can buy a badge');
  if (!GUILD_BADGES.includes(badge)) throw new Error('Invalid badge');
  if (player.crystalBalance < GUILD_BADGE_COST) throw new Error(`Not enough crystals — a badge costs ${GUILD_BADGE_COST}`);

  player.crystalBalance -= GUILD_BADGE_COST;
  crystalTransactions.push({ id: id(), playerId, amount: -GUILD_BADGE_COST, source: 'guild_badge_purchase', createdAt: Date.now() });
  guild.badge = badge;
  return { guild, crystalBalance: player.crystalBalance };
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
  const rows = guild.memberIds
    .map((pid) => {
      const player = players.get(pid);
      if (!player) return null;
      const dex = getDex(pid);
      return {
        playerId: pid,
        id: pid, // presence.decorate keys off `id`
        username: player.username,
        totalCaught: dex.totalCaught,
        totalSpecies: dex.totalSpecies,
        percentComplete: dex.percentComplete,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.totalCaught - a.totalCaught);
  // Online dot on every guild member, same shape as the friends list.
  return presence.decorate(rows);
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
  const code = opts.code, rewardCrystals = opts.rewardCrystals || 0, rewardSpeciesId = opts.rewardSpeciesId || null, rewardPaint = opts.rewardPaint || 0, rewardNovaChips = opts.rewardNovaChips || 0, maxUses = opts.maxUses != null ? opts.maxUses : null;
  const key = code.toUpperCase();
  const row = { code: key, rewardCrystals, rewardSpeciesId, rewardPaint, rewardNovaChips, maxUses, usedByPlayerIds: [] };
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
  player.paint += row.rewardPaint || 0;
  player.novaChips += row.rewardNovaChips || 0;

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

  return { crystalsGranted: row.rewardCrystals, paintGranted: row.rewardPaint || 0, novaChipsGranted: row.rewardNovaChips || 0, droid: droid, crystalBalance: player.crystalBalance };
}

// Seeds the small set of "official" starter codes if they don't already
// exist — called once at server startup so these work automatically on
// every fresh deploy without a manual create step. Idempotent: safe to
// call again after a restore (won't duplicate or reset usage history).
function seedStarterRedeemCodes() {
  if (!redeemCodes.has('PAINTME10')) createRedeemCode({ code: 'PAINTME10', rewardPaint: 10 });
  if (!redeemCodes.has('WELCOME')) createRedeemCode({ code: 'WELCOME', rewardCrystals: 500 });
  if (!redeemCodes.has('CHIPSTART')) createRedeemCode({ code: 'CHIPSTART', rewardNovaChips: 3 });
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
    factoryCooldownUntil: null,
    beacons: 0,
    beaconActiveUntil: null,
    depotCooldownUntil: null,
    augmentCores: 0,
    timeWarps: 0,
    growths: 0,
    lightStones: 0,
    darkCrystals: 0,
    padRam: 0,
    repairKits: 0,
    titanCooldownUntil: null,
    energyTubes: 0,
    displayedBadge: null,
    dismissedPosters: [],
    equippedCosmetics: { head: null, body: null, arms: null, legs: null },
    friends: [],
    friendRequestsSent: [],
    friendRequestsReceived: [],
    zombieJuice: 0,
    lumeCells: 0,
    outfit: 'basic',
    ownedOutfits: ['basic'],
    lastScanAt: null,
    lastCaptureAttemptAt: null,
    autoReleaseDuplicates: false,
    autoReleaseIncludeVariants: false,
    apexCubes: 0,
    titanTokens: 0,
    guildTokens: 0,
    joyCoins: 0,
    apexCooldownUntil: null,
    joystickSession: null,
    joystickCooldownUntil: null,
    // ---- Player levels / Re-Boot (v0.4) ----
    playerLevel: 0,
    playerXp: 0,
    lifetimeXp: 0,
    rebootCount: 0,
    lastRebootAt: null,
    unlockedLevelBadges: [],
    unlockedRebootBadges: [],
    // Achievement buff totals, maintained by the achievements system.
    achievementBuffs: {},
    // attachmentId -> count owned (equipped units stay counted here)
    attachments: {},
    ownedCosmeticPieces: [],
    equippedCosmetics: { head: null, body: null, arms: null, legs: null },
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

  // give every new player 5 Processor slots, ALL locked to start — a
  // bigger commitment than farming, no free slot.
  for (let i = 0; i < PROCESSOR_SLOT_COUNT; i++) {
    const slot = { id: id(), playerId: player.id, slotIndex: i, unlocked: false, eggId: null, hatchReadyAt: null };
    processorSlots.set(slot.id, slot);
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

// Requires the CURRENT pin as proof, even though the player is already
// logged in — same reasoning most apps use for password changes: if
// someone's device is left unlocked, a PIN change shouldn't be a free
// way to lock the real owner out permanently.
function setAutoReleaseDuplicates(playerId, enabled) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  player.autoReleaseDuplicates = !!enabled;
  return { autoReleaseDuplicates: player.autoReleaseDuplicates };
}

function setAutoReleaseIncludeVariants(playerId, enabled) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  player.autoReleaseIncludeVariants = !!enabled;
  return { autoReleaseIncludeVariants: player.autoReleaseIncludeVariants };
}

function changePin(playerId, currentPin, newPin) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.pin !== currentPin) throw new Error('Current PIN is incorrect');
  if (!newPin || !/^\d{4,8}$/.test(newPin)) throw new Error('New PIN must be 4-8 digits');
  player.pin = newPin;
  return { success: true };
}

// Admin-only reset — no proof of the current PIN required, since this
// exists specifically for the case where a player has no PIN set (or
// forgot it) and can't clear the normal changePin bar themselves.
function adminResetPin(playerId, newPin) {
  const player = players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!newPin || !/^\d{4,8}$/.test(newPin)) throw new Error('New PIN must be 4-8 digits');
  player.pin = newPin;
  return { success: true, username: player.username };
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

// Collections that award a free outfit once every species in them has
// been caught — checked after every Dex update. Outfit isn't in the
// Shop catalog since it can't be bought, only earned.
const COLLECTION_COMPLETION_OUTFITS = {
  void_zombie: 'void_warden',
  lumen_sentinel: 'lumen_warden',
};

function checkCollectionCompletionRewards(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  Object.entries(COLLECTION_COMPLETION_OUTFITS).forEach(([collection, outfitId]) => {
    if (player.ownedOutfits.includes(outfitId)) return; // already earned
    const speciesInCollection = droidSpecies.filter((s) => s.collection === collection);
    const allCaught = speciesInCollection.every((s) => player.dexSeen.includes(s.id));
    if (allCaught && speciesInCollection.length > 0) {
      player.ownedOutfits.push(outfitId);
    }
  });
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
  checkCollectionCompletionRewards(playerId);
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
    if (evolvesToIds.has(s.id)) return; // not a chain origin — placed inline below instead
    orderedSpecies.push(s);
    // Walk the FULL chain from this origin, not just one hop — a 4-tier
    // chain (e.g. Shambler->Walker->Corruptor->Voidlord) needs every
    // link followed, not just the first, or later tiers silently vanish
    // from the Dex entirely (confirmed real bug, found via testing).
    let current = s;
    while (EVOLUTION_TABLE[current.id]) {
      const nextSpecies = mainSpeciesPool.find((e) => e.id === EVOLUTION_TABLE[current.id].evolvesTo);
      if (!nextSpecies) break;
      orderedSpecies.push(nextSpecies);
      current = nextSpecies;
    }
  });

  // Reverse lookup: for an evolution-only species, which species does it
  // evolve FROM? Lets the client show "evolves from X" without needing
  // its own copy of the evolution table.
  const evolvesFromMap = {};
  Object.entries(EVOLUTION_TABLE).forEach(([fromId, evo]) => {
    const fromSpecies = droidSpecies.find((s) => s.id === Number(fromId));
    if (fromSpecies) evolvesFromMap[evo.evolvesTo] = fromSpecies.name;
  });

  const buildEntry = (s) => {
    const funkyColorsCaught = PRIMARY_COLORS.filter((c) => variantsSeen.includes(`${s.id}:funky:${c}`));
    return {
      ...s,
      caught: seen.includes(s.id),
      variantsCaught: ['platinum', 'rusty', 'funky'].filter((v) => variantsSeen.includes(`${s.id}:${v}`)),
      funkyColorsCaught,
      evolvesFromName: evolvesFromMap[s.id] || null,
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
      guildName: p.guildId ? (guilds.get(p.guildId)?.name || null) : null,
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
    processorSlots: [...processorSlots.values()],
    eggs: [...eggs.values()],
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
  processorSlots.clear();
  eggs.clear();

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
    factoryCooldownUntil: null,
    beacons: 0,
    beaconActiveUntil: null,
    depotCooldownUntil: null,
    augmentCores: 0,
    timeWarps: 0,
    growths: 0,
    lightStones: 0,
    darkCrystals: 0,
    padRam: 0,
    repairKits: 0,
    titanCooldownUntil: null,
    energyTubes: 0,
    displayedBadge: null,
    dismissedPosters: [],
    equippedCosmetics: { head: null, body: null, arms: null, legs: null },
    friends: [],
    friendRequestsSent: [],
    friendRequestsReceived: [],
    zombieJuice: 0,
    lumeCells: 0,
    outfit: 'basic',
    ownedOutfits: ['basic'],
    lastScanAt: null,
    lastCaptureAttemptAt: null,
    autoReleaseDuplicates: false,
    autoReleaseIncludeVariants: false,
    // v0.2 additions — players saved before Apex/tokens existed get these
    // filled in on load rather than coming back undefined (which would
    // render as NaN the moment anything did arithmetic on them).
    apexCubes: 0,
    titanTokens: 0,
    guildTokens: 0,
    joyCoins: 0,
    apexCooldownUntil: null,
    joystickSession: null,
    joystickCooldownUntil: null,
    // ---- Player levels / Re-Boot (v0.4) ----
    playerLevel: 0,
    playerXp: 0,
    lifetimeXp: 0,
    rebootCount: 0,
    lastRebootAt: null,
    unlockedLevelBadges: [],
    unlockedRebootBadges: [],
    // Achievement buff totals, maintained by the achievements system.
    achievementBuffs: {},
    // attachmentId -> count owned (equipped units stay counted here)
    attachments: {},
    ownedCosmeticPieces: [],
    equippedCosmetics: { head: null, body: null, arms: null, legs: null },
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
  (state.processorSlots || []).forEach((s) => processorSlots.set(s.id, s));
  (state.eggs || []).forEach((e) => eggs.set(e.id, e));

  // Players saved before Processor slots existed won't have any — seed
  // the standard 5 locked slots for them too, same as a brand-new player.
  for (const player of players.values()) {
    const hasSlots = [...processorSlots.values()].some((s) => s.playerId === player.id);
    if (!hasSlots) {
      for (let i = 0; i < PROCESSOR_SLOT_COUNT; i++) {
        const slot = { id: id(), playerId: player.id, slotIndex: i, unlocked: false, eggId: null, hatchReadyAt: null };
        processorSlots.set(slot.id, slot);
      }
    }
  }

  // Recompute the id counter so newly-created rows never collide with
  // restored ones, regardless of what was in flight when the snapshot was taken.
  let maxId = 0;
  for (const coll of [players, ownedDroids, workshopSlots, tradeOffers, events, guilds, processorSlots, eggs]) {
    for (const row of coll.values()) if (row.id > maxId) maxId = row.id;
  }
  for (const t of crystalTransactions) if (t.id > maxId) maxId = t.id;
  nextId = maxId + 1;
}

module.exports = {
  droidSpecies,
  FOOTBALL_WINDOWS,
  DAILY_LINE_WINDOWS,
  EVOLUTION_TABLE,
  SCAFFITAN_MASTERY_TABLE,
  RARITY_TTL_MS,
  RARITY_MAX_PER_CELL,
  LEGENDARY_CITY_CAP,
  COSMIC_CITY_CAP,
  MIN_CRYSTAL_COST,
  RELEASE_REFUND_MULTIPLIER,
  PAD_LEVEL_COST_SCALING,
  scaledMinCrystalCost,
  VARIANT_ODDS,
  VARIANT_CRYSTAL_MULTIPLIER,
  TESTING_HIGH_VARIANT_ODDS,
  rollVariant,
  FUNKY_EVOLVE_PAINT_COST,
  PRIMARY_COLORS,
  slotUnlockCost,
  DROID_LEVEL_CAP,
  levelUpCost,
  // ---- Apex ----
  APEX_CITY_CAP,
  APEX_CUBE_MIN_DROP,
  APEX_CUBE_MAX_DROP,
  apexCubeLevelUpCost,
  rollApexCubeDrop,
  isApexSpecies,
  apexSpeciesList,
  createApexHuntEvent,
  isApexHuntActive,
  APEX_HUNT_DURATION_MS,
  APEX_HUNT_GRANT_WEIGHT,
  APEX_HUNT_COOLDOWN_MS,
  PAD_SKILL_CEILING_PER_LEVEL,
  padUpgradeCost,
  padRequiresRam,
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
  SHOP_CATALOG,
  TRADEABLE_MATERIALS,
  buyShopItem,
  buyShopBasket,
  equipOutfit,
  useTimeWarp,
  useGrowth,
  SCAN_RATE_LIMIT_MS,
  checkScanRateLimit,
  DEPOT_AUGMENT_CORE_CHANCE,
  guilds,
  battles,
  GUILD_MAX_MEMBERS,
  createGuild,
  joinGuild,
  leaveGuild,
  kickFromGuild,
  setGuildBadge,
  setGuildNotice,
  buyGuildBadge,
  GUILD_BADGES,
  GUILD_BADGE_COST,
  GUILD_NOTICE_MAX_LENGTH,
  postGuildMessage,
  getGuildMessages,
  getGuildLeaderboard,
  activateCompanionBuff,
  listPlayersAdmin,
  deletePlayerAdmin,
  redeemCodes,
  createRedeemCode,
  redeemCodeFn,
  seedStarterRedeemCodes,
  processorSlots,
  eggs,
  PROCESSOR_SLOT_COUNT,
  PROCESSOR_SLOT_COSTS,
  FACTORY_MINIGAME_COST,
  FACTORY_START_HATCH_COST,
  FACTORY_HATCH_DURATION_MS,
  FACTORY_COOLDOWN_MS,
  CRUSH_NOVA_CHIP_CHANCE,
  rollPrototypeRarity,
  eligiblePrototypeSpecies,
  BEACON_COST,
  BEACON_DURATION_MS,
  BEACON_BOOST_MULTIPLIER,
  buyBeacon,
  activateBeacon,
  isBeaconActive,
  markCellBeaconBoosted,
  isCellBeaconBoosted,
  DEPOT_MINIGAME_COST,
  DEPOT_COOLDOWN_MS,
  attemptDepot,
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
  changePin,
  adminResetPin,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getFriendsData,
  reactToPoster,
  getPosterReactions,
  dismissPoster,
  setAutoReleaseDuplicates,
  setAutoReleaseIncludeVariants,
  grantStarterDroid,
  markDexSeen,
  getDex,
  exportState,
  importState,
  nextId: () => id(),
};
