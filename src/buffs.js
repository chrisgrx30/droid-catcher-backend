// buffs.js
//
// ONE place where every buff in Sparkfield is combined and capped.
//
// WHY THIS FILE EXISTS
// Five systems now grant buffs — achievements, cosmetics (incl. the
// 4-piece set bonus), droid attachments, Re-Boot, and the existing
// companion / Galactic droid buffs. Without a central engine each of
// those would apply its own percentage wherever it happened to be
// convenient, and nobody could answer "what is this player's actual
// catch rate?" without reading five modules.
//
// THE STACKING POLICY
// Additive WITHIN a source, multiplicative ACROSS sources.
//
//   Three attachments at +5/+7/+10% HP  ->  one source, +22% total
//   Then that source multiplies against cosmetics, against Re-Boot, etc.
//
// Why not fully additive: at maximum progression the raw total exceeds
// +200%, and additive stacking turns that into a cliff — the last few
// achievements are worth as much as the first fifty. Multiplicative
// stacking gives diminishing returns naturally, so late buffs still
// feel good without breaking the curve.
//
// Why not fully multiplicative: stacking 56 separate achievement
// multipliers compounds absurdly (1.005^56 is fine, but 1.02^56 is
// 3x). Grouping by source keeps each system's internal budget
// predictable and easy to tune.
//
// THE CAPS
// Multiplicative stacking still grows without bound, so every buff type
// has a hard ceiling. These are deliberately generous EXCEPT catch rate
// — see the note on that below, it's the one that can quietly ruin the
// endgame.
//
// EVERYTHING HERE IS CONFIG, NOT LOGIC
// The level.pdf asked for a system where percentages, caps and sources
// can be changed without rebuilding. Adding a new buff source means
// adding a function to SOURCES below. Nothing else changes.

const db = require('./db');
const attachments = require('./attachments');
const cosmetics = require('./cosmetics');

// ---- buff types ----
// Every buff in the game resolves to one of these keys.
const BUFF_TYPES = [
  'hp',
  'attack',
  'catchRate',
  'crystalRate',
  'materialReward',
  'variantOdds',
  'minigameOdds',
  'evolutionCost',   // negative = cheaper
  'shopCost',        // negative = cheaper
  'hatchSpeed',
];

// ---- caps ----
// Maximum TOTAL multiplier from all sources combined. 1.5 = +50%.
//
// catchRate is the tight one on purpose. Apex sits at a 2% base rate
// specifically so it stays a chase. Multiple achievements grant catch
// rate, and if those were uncapped (or worse, applied as percentage
// POINTS rather than relative %) a maxed player would reach Apex rates
// several times the intended one and the endgame would evaporate. At
// this cap, 2% can reach at most 2.5% — a real reward for progression
// that doesn't dismantle the design.
const BUFF_CAPS = {
  hp: 2.5,             // +150%
  attack: 2.5,         // +150%
  catchRate: 1.25,     // +25% RELATIVE, never absolute percentage points
  crystalRate: 4.0,    // +300% — the grind stat, deliberately generous
  materialReward: 2.0, // +100%
  variantOdds: 2.0,    // +100% (1/1000 -> at best 1/500)
  minigameOdds: 1.2,   // +20%
  evolutionCost: 1.0,  // handled as a discount floor below
  shopCost: 1.0,
  hatchSpeed: 2.0,     // +100% faster
};

// Discounts are floors rather than ceilings — nothing can ever become
// free, or the economy has no sink left.
const MIN_COST_MULTIPLIER = 0.5; // never cheaper than half price

// A hard ceiling on the FINAL capture chance regardless of buffs. No
// droid should ever be a guaranteed catch — that removes the minigame
// from the game.
const ABSOLUTE_MAX_CATCH_RATE = 0.95;

function emptyBuffSet() {
  const out = {};
  BUFF_TYPES.forEach((k) => { out[k] = 0; });
  return out;
}

// ---- sources ----
// Each returns an ADDITIVE percentage set (0.05 = +5%) for one system.
// Sources are combined multiplicatively by totalMultipliers() below.
//
// Systems not built yet return zeros. They're listed here so the shape
// is fixed now and turning each one on later is a one-function change
// rather than a refactor.
const SOURCES = {
  // Re-Boot: +2% crystal generation on odd re-boots, +2% material
  // rewards on even ones, permanent and cumulative.
  reboot(player) {
    const set = emptyBuffSet();
    const count = player.rebootCount || 0;
    const crystalSteps = Math.ceil(count / 2);
    const materialSteps = Math.floor(count / 2);
    set.crystalRate = crystalSteps * 0.02;
    set.materialReward = materialSteps * 0.02;
    return set;
  },

  achievements(player) {
    const set = emptyBuffSet();
    const earned = player.achievementBuffs;
    if (!earned) return set;
    // achievementBuffs is a flat map of buffType -> additive total,
    // maintained by achievements.js as tiers are unlocked.
    Object.keys(earned).forEach((k) => {
      if (set[k] !== undefined) set[k] += earned[k];
    });
    return set;
  },

  cosmetics(player) {
    const set = emptyBuffSet();
    if (!player.equippedCosmetics) return set;
    // Includes the four-piece set bonus. Cosmetics are worn by the
    // pilot, so these are player-wide rather than per-droid.
    const contributed = cosmetics.playerBuffSet(player);
    Object.keys(contributed).forEach((k) => {
      if (set[k] !== undefined) set[k] += contributed[k];
    });
    return set;
  },

  attachments(player) {
    const set = emptyBuffSet();
    // Only PLAYER-level effects come through here (crystal rate).
    // HP/attack from an attachment apply to the droid wearing it, not
    // the whole roster — those are handled in workshop.js.
    const contributed = attachments.playerBuffSet(player);
    Object.keys(contributed).forEach((k) => {
      if (set[k] !== undefined) set[k] += contributed[k];
    });
    return set;
  },
};

// Combines every source. Returns a multiplier per buff type, capped.
function totalMultipliers(player) {
  const result = {};
  BUFF_TYPES.forEach((type) => {
    let multiplier = 1;
    Object.values(SOURCES).forEach((fn) => {
      const set = fn(player) || {};
      const additive = set[type] || 0;
      // Additive within the source, then multiplied across sources.
      multiplier *= (1 + additive);
    });
    const cap = BUFF_CAPS[type];
    result[type] = cap ? Math.min(multiplier, cap) : multiplier;
  });
  return result;
}

// Convenience for a single type — avoids recomputing every source when
// a caller only needs one number.
function multiplierFor(player, type) {
  if (!player) return 1;
  return totalMultipliers(player)[type] || 1;
}

// Capture rate is special enough to get its own helper, so no caller
// can accidentally apply it as percentage points or skip the absolute
// ceiling.
function applyCatchRateBuff(player, baseRate) {
  const m = multiplierFor(player, 'catchRate');
  return Math.min(ABSOLUTE_MAX_CATCH_RATE, baseRate * m);
}

// Discounts: buff value is negative, so a -20% shop cost buff returns
// 0.8. Floored so nothing is ever free.
function costMultiplierFor(player, type) {
  const m = multiplierFor(player, type);
  const discounted = 2 - m; // m of 1.2 (+20% discount buff) -> 0.8
  return Math.max(MIN_COST_MULTIPLIER, Math.min(1, discounted));
}

// For the UI — a readable breakdown so players can see where their
// numbers come from, and so we can debug balance complaints.
function breakdownFor(player) {
  const perSource = {};
  Object.entries(SOURCES).forEach(([name, fn]) => {
    const set = fn(player) || {};
    const nonZero = {};
    Object.entries(set).forEach(([k, v]) => { if (v) nonZero[k] = v; });
    if (Object.keys(nonZero).length) perSource[name] = nonZero;
  });
  const totals = totalMultipliers(player);
  const capped = {};
  Object.keys(totals).forEach((k) => {
    if (BUFF_CAPS[k] && totals[k] >= BUFF_CAPS[k]) capped[k] = true;
  });
  return { perSource, totals, capped, caps: BUFF_CAPS };
}

module.exports = {
  BUFF_TYPES,
  BUFF_CAPS,
  ABSOLUTE_MAX_CATCH_RATE,
  MIN_COST_MULTIPLIER,
  SOURCES,
  emptyBuffSet,
  totalMultipliers,
  multiplierFor,
  applyCatchRateBuff,
  costMultiplierFor,
  breakdownFor,
};
