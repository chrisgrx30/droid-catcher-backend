// ---- Droid Memory ----
// Every droid keeps a permanent record of what it has done. This is the
// data layer that Traits, Legacy and Veteran status are all derived
// from, so those stay consistent by construction rather than by keeping
// several copies of the same counters in sync.
//
// History travels WITH the droid on a trade (confirmed) — the original
// capturer is recorded so a traded veteran still shows where it came
// from.

const db = require('./db');

// Every counter starts at 0 so callers never have to null-check.
function blankHistory() {
  return {
    // Origin — set once at capture, never changed afterwards.
    capturedAt: null,
    capturedLat: null,
    capturedLng: null,
    capturedSector: null,
    capturedByPlayerId: null,
    capturedByName: null,

    // Lifetime counters.
    battles: 0,
    battlesWon: 0,
    bossesDefeated: 0,
    droidsDefeated: 0,
    crystalsGenerated: 0,
    missionsCompleted: 0,
    riftMissions: 0,
    riftStormsSurvived: 0,
    timesHealed: 0,
    upgrades: 0,
    reboots: 0,
  };
}

function historyOf(droid) {
  if (!droid) return null;
  if (!droid.history) droid.history = blankHistory();
  return droid.history;
}

// Records where and by whom a droid was first caught. Deliberately
// no-ops if origin is already set, so it can't be overwritten by a
// later code path (or by a trade).
function recordCapture(droid, { playerId, lat, lng, sector } = {}) {
  const h = historyOf(droid);
  if (h.capturedAt) return h;
  const player = playerId != null ? db.players.get(playerId) : null;
  h.capturedAt = droid.capturedAt || Date.now();
  h.capturedLat = lat != null ? lat : null;
  h.capturedLng = lng != null ? lng : null;
  h.capturedSector = sector || null;
  h.capturedByPlayerId = playerId != null ? playerId : null;
  h.capturedByName = player ? player.username : null;
  return h;
}

// Generic counter bump. Unknown keys are ignored rather than silently
// creating typo'd fields that would never show up in the UI.
function bump(droid, key, amount = 1) {
  const h = historyOf(droid);
  if (!(key in h)) return h;
  if (typeof h[key] !== 'number') return h;
  h[key] += amount;
  return h;
}

function bumpMany(droidOrIds, updates) {
  const droid = typeof droidOrIds === 'object' ? droidOrIds : db.ownedDroids.get(droidOrIds);
  if (!droid) return null;
  Object.entries(updates || {}).forEach(([k, v]) => bump(droid, k, v));
  return droid.history;
}

// ---- Traits ----
// Derived from history, never stored. Changing a threshold takes effect
// immediately with no migration, and a droid's trait can never disagree
// with its own counters.
const TRAIT_DEFS = [
  {
    id: 'veteran', name: 'Veteran', icon: '⚔️',
    description: 'Fought in many battles',
    effect: '+2% XP earned in battle',
    test: (h) => h.battles >= 50,
    progress: (h) => ({ have: h.battles, need: 50 }),
  },
  {
    id: 'rift_touched', name: 'Rift-Touched', icon: '🌌',
    description: 'Repeatedly taken into the Rift',
    effect: 'Slightly increased Rift loot',
    test: (h) => h.riftMissions >= 10,
    progress: (h) => ({ have: h.riftMissions, need: 10 }),
  },
  {
    id: 'industrial', name: 'Industrial', icon: '🏭',
    description: 'Generated a great deal of crystal',
    effect: 'Small production bonus',
    test: (h) => h.crystalsGenerated >= 5000,
    progress: (h) => ({ have: Math.floor(h.crystalsGenerated), need: 5000 }),
  },
  {
    id: 'pathfinder', name: 'Pathfinder', icon: '🧭',
    description: 'Completed many missions',
    effect: 'Slightly increased exploration loot',
    test: (h) => h.missionsCompleted >= 25,
    progress: (h) => ({ have: h.missionsCompleted, need: 25 }),
  },
  {
    id: 'boss_hunter', name: 'Boss Hunter', icon: '🏆',
    description: 'Brought down numerous bosses',
    effect: 'Bonus damage against bosses',
    test: (h) => h.bossesDefeated >= 15,
    progress: (h) => ({ have: h.bossesDefeated, need: 15 }),
  },
];

function traitsFor(droid) {
  const h = historyOf(droid);
  return TRAIT_DEFS.filter((t) => t.test(h)).map((t) => ({
    id: t.id, name: t.name, icon: t.icon,
    description: t.description, effect: t.effect,
  }));
}

// Everything, earned or not, with progress — so the UI can show what a
// droid is working toward rather than only what it already has.
function traitProgressFor(droid) {
  const h = historyOf(droid);
  return TRAIT_DEFS.map((t) => {
    const p = t.progress(h);
    return {
      id: t.id, name: t.name, icon: t.icon,
      description: t.description, effect: t.effect,
      earned: t.test(h),
      have: p.have, need: p.need,
      percent: Math.min(100, Math.round((p.have / p.need) * 100)),
    };
  });
}

// ---- Veteran / Legendary status ----
// A recognition tier rather than a power tier, so this can't wreck the
// economy. Small bonuses only.
const VETERAN_THRESHOLD = 3; // traits earned

function statusFor(droid) {
  const traits = traitsFor(droid);
  const h = historyOf(droid);
  const isVeteran = traits.length >= VETERAN_THRESHOLD;
  return {
    isVeteran,
    title: isVeteran ? 'Veteran' : null,
    traitCount: traits.length,
    traitsNeeded: VETERAN_THRESHOLD,
    // Rough "how much has this droid actually done" score, used to pick
    // a player's standout droids for their profile.
    legacyScore:
      h.battles * 2 +
      h.bossesDefeated * 25 +
      h.riftMissions * 10 +
      h.missionsCompleted * 5 +
      Math.floor(h.crystalsGenerated / 100) +
      h.riftStormsSurvived * 15,
  };
}

// Full memory view for one droid, for the stats screen.
function viewFor(droidId) {
  const droid = db.ownedDroids.get(droidId);
  if (!droid) return null;
  const h = historyOf(droid);
  const species = db.droidSpecies.find((s) => s.id === droid.speciesId);
  return {
    droidId: droid.id,
    speciesName: species ? species.name : 'Unknown',
    rarity: species ? species.rarity : null,
    variant: droid.variant,
    history: { ...h },
    traits: traitsFor(droid),
    traitProgress: traitProgressFor(droid),
    status: statusFor(droid),
    // True when the current owner isn't the original capturer — the
    // droid was traded, and the UI should say so rather than implying
    // this player earned the history.
    tradedFrom: h.capturedByPlayerId != null && h.capturedByPlayerId !== droid.playerId
      ? h.capturedByName
      : null,
  };
}

// A player's most accomplished droids, for the Chronicle.
function topDroidsFor(playerId, limit = 3) {
  return [...db.ownedDroids.values()]
    .filter((d) => d.playerId === playerId)
    .map((d) => {
      const species = db.droidSpecies.find((s) => s.id === d.speciesId);
      const st = statusFor(d);
      return {
        droidId: d.id,
        speciesName: species ? species.name : 'Unknown',
        rarity: species ? species.rarity : null,
        variant: d.variant,
        level: d.level,
        legacyScore: st.legacyScore,
        isVeteran: st.isVeteran,
        traits: traitsFor(d),
        history: { ...historyOf(d) },
      };
    })
    .filter((d) => d.legacyScore > 0)
    .sort((a, b) => b.legacyScore - a.legacyScore)
    .slice(0, limit);
}

module.exports = {
  blankHistory,
  historyOf,
  recordCapture,
  bump,
  bumpMany,
  TRAIT_DEFS,
  traitsFor,
  traitProgressFor,
  statusFor,
  viewFor,
  topDroidsFor,
  VETERAN_THRESHOLD,
};
