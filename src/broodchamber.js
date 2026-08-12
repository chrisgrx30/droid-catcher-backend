// broodchamber.js
//
// THE BROOD CHAMBER — merge two droids into an Astral Brood egg.
//
// Genesis Bays are the incubation slots. Both parents are consumed at
// the moment of merging, an egg goes into a free Bay, and it hatches
// after a rarity-dependent wait.
//
// THE OUTCOME MATRIX (my call, per your brief)
// Rules the matrix has to satisfy:
//   1. The result is NEVER worse than the LOWER of the two parents.
//   2. Two of the same rarity guarantee at least that rarity, so
//      Legendary x Legendary is a guaranteed Legendary or better.
//   3. Pairing up with something rarer improves the odds.
//   4. Galactic (Astralmatron) is essentially unreachable from a
//      Common x Common merge and only becomes a real prospect at
//      Legendary x Legendary — and even then it's rare.
//
// How it works: each rarity has a numeric tier. A merge takes the
// FLOOR (the lower parent's tier) as its guaranteed minimum, then rolls
// for an upgrade. Upgrade chance scales with the combined tier of both
// parents, so a Common paired with a Legendary has a much better shot
// than two Commons — while never dropping below Common.
//
// This gives a smooth curve without needing a hand-written 5x5 table,
// and adding a rarity later means adding one line to TIERS.

const db = require('./db');
const levels = require('./levels');

// ---- tuning ----
const MERGE_COST_CRYSTALS = 5000;
const BAY_BASE_COST = 10000;      // first Bay
const BAY_COST_INCREMENT = 10000; // each further Bay costs this much more
const MAX_BAYS = 5;

// Rarity ladder used for both outcome rolls and hatch times.
const TIERS = ['common', 'uncommon', 'rare', 'legendary', 'galactic'];
const tierOf = (rarity) => Math.max(0, TIERS.indexOf(rarity));

// Hatch time by RESULT rarity. Confirmed anchors: common ~1 hour,
// legendary ~3 days. The middle tiers interpolate on a curve rather
// than linearly, so the jump to Legendary feels like a real commitment.
const HATCH_MS = {
  common: 1 * 60 * 60 * 1000,        // 1 hour
  uncommon: 4 * 60 * 60 * 1000,      // 4 hours
  rare: 18 * 60 * 60 * 1000,         // 18 hours
  legendary: 3 * 24 * 60 * 60 * 1000, // 3 days
  galactic: 5 * 24 * 60 * 60 * 1000,  // 5 days
};

// Per-step upgrade chance. Read as: "given the parents' combined tier,
// what's the chance of climbing one rarity above the floor?" The roll
// repeats, so climbing two steps requires passing twice — which is what
// makes Galactic from a Common x Common merge effectively impossible
// (0.02^4, about 1 in 6 million).
//
// combinedTier = tierOf(a) + tierOf(b), range 0..8
//
// GALACTIC_STEP_MULTIPLIER applies ONLY to the last step. Astralmatron
// is the capstone of the Brood collection, so even a perfect pairing
// should mostly fail to produce her.
const GALACTIC_STEP_MULTIPLIER = 0.15;

const UPGRADE_CHANCE_BY_COMBINED_TIER = {
  0: 0.02,  // common + common
  1: 0.05,
  2: 0.10,
  3: 0.16,
  4: 0.22,
  5: 0.28,
  6: 0.34,  // legendary + legendary
  7: 0.40,
  8: 0.45,
};

// Astral Brood species by rarity. These are the ONLY things a merge can
// produce — the whole point of the Chamber is a separate lineage.
const BROOD_NAMES = {
  galactic: ['Astralmatron'],
  legendary: ['Voidpaladin', 'Starwarden'],
  rare: ['Crystacore', 'Forgegrub'],
  uncommon: ['Nebulonix', 'Gravimite'],
  common: ['Sparkmite', 'Dustbyte', 'Orbitch'],
};

class BroodError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function broodSpeciesByRarity(rarity) {
  const names = BROOD_NAMES[rarity] || [];
  return db.droidSpecies.filter((s) => names.includes(s.name));
}

// Astralmatron is the collection's capstone: it can drop from a merge,
// but only once every OTHER Brood droid has been recorded in the Dex.
// Until then an upgrade that would land on Galactic falls back to
// Legendary, so the roll is never wasted.
function hasCompleteBroodDex(playerId) {
  const dex = db.getDex(playerId);
  const needed = Object.entries(BROOD_NAMES)
    .filter(([rarity]) => rarity !== 'galactic')
    .flatMap(([, names]) => names);
  const caught = new Set(
    dex.entries.filter((e) => e.caught).map((e) => e.name)
  );
  return needed.every((n) => caught.has(n));
}

function rollOutcomeRarity(rarityA, rarityB, playerId, keeperBonus = 0) {
  const tierA = tierOf(rarityA);
  const tierB = tierOf(rarityB);
  // Rule 1 and 2: the lower parent sets the guaranteed floor.
  let tier = Math.min(tierA, tierB);
  const combined = tierA + tierB;
  const baseChance = UPGRADE_CHANCE_BY_COMBINED_TIER[combined] ?? 0.02;
  const chance = Math.min(0.85, baseChance + keeperBonus);

  while (tier < TIERS.length - 1) {
    // The final step into Galactic is deliberately far harder than any
    // other. Without this, Legendary x Legendary would land on
    // Astralmatron about a third of the time — the capstone of the
    // whole collection shouldn't be a coin flip.
    const stepChance = TIERS[tier + 1] === 'galactic'
      ? chance * GALACTIC_STEP_MULTIPLIER
      : chance;
    if (Math.random() >= stepChance) break;
    tier += 1;
  }

  let rarity = TIERS[tier];
  if (rarity === 'galactic' && !hasCompleteBroodDex(playerId)) {
    rarity = 'legendary';
  }
  return rarity;
}

// ---- bays ----

function baysFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new BroodError('NO_PLAYER', 'Player not found');
  player.genesisBays = player.genesisBays || [];
  return player.genesisBays;
}

function nextBayCost(playerId) {
  const owned = baysFor(playerId).length;
  if (owned >= MAX_BAYS) return null;
  return BAY_BASE_COST + owned * BAY_COST_INCREMENT;
}

function buyBay(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new BroodError('NO_PLAYER', 'Player not found');
  const bays = baysFor(playerId);
  if (bays.length >= MAX_BAYS) throw new BroodError('MAX_BAYS', `You already own all ${MAX_BAYS} Genesis Bays`);
  const cost = nextBayCost(playerId);
  if ((player.crystalBalance || 0) < cost) {
    throw new BroodError('NOT_ENOUGH_CRYSTALS', `Genesis Bay ${bays.length + 1} costs ${cost.toLocaleString()} crystals`);
  }
  player.crystalBalance -= cost;
  db.crystalTransactions.push({
    id: db.nextId(), playerId, amount: -cost, source: 'genesis_bay', createdAt: Date.now(),
  });
  bays.push({ id: db.nextId(), egg: null });
  return statusFor(playerId);
}

// ---- chamber keeper ----
// One assignable droid slot granting a merge bonus. Locked until a
// Chamber Keeper exists — that item isn't designed yet, so the slot
// reports itself locked rather than silently doing nothing.
const KEEPER_UNLOCKED = false;
const KEEPER_UPGRADE_BONUS = 0.05;

function keeperBonusFor(player) {
  if (!KEEPER_UNLOCKED) return 0;
  return player.chamberKeeperDroidId ? KEEPER_UPGRADE_BONUS : 0;
}

// ---- merging ----

function merge(playerId, droidIdA, droidIdB) {
  const player = db.players.get(playerId);
  if (!player) throw new BroodError('NO_PLAYER', 'Player not found');
  if (droidIdA === droidIdB) throw new BroodError('SAME_DROID', 'Pick two different droids');

  const a = db.ownedDroids.get(droidIdA);
  const b = db.ownedDroids.get(droidIdB);
  if (!a || a.playerId !== playerId) throw new BroodError('NO_DROID', 'First droid not found');
  if (!b || b.playerId !== playerId) throw new BroodError('NO_DROID', 'Second droid not found');

  // A droid in a workshop slot, acting as companion, or assigned as
  // buddy is doing a job — destroying it silently would be a nasty
  // surprise, so those have to be unassigned first.
  [a, b].forEach((d) => {
    if (d.workshopSlotId) throw new BroodError('IN_WORKSHOP', 'Remove the droid from its workshop slot first');
    if (player.companionDroidId === d.id) throw new BroodError('IS_COMPANION', 'That droid is your active companion');
    if (player.buddyDroidId === d.id) throw new BroodError('IS_BUDDY', 'That droid is your mastery buddy');
    if (d.fortId) throw new BroodError('IN_FORT', 'That droid is garrisoned in a Fort — withdraw it first');
    if (d.smugglerRun) throw new BroodError('ON_RUN', "That droid is out on a Smuggler's Run");
  });

  const speciesA = db.droidSpecies.find((s) => s.id === a.speciesId);
  const speciesB = db.droidSpecies.find((s) => s.id === b.speciesId);
  if (!speciesA || !speciesB) throw new BroodError('BAD_SPECIES', 'Unknown species');

  // Event-exclusive and Apex droids are deliberately excluded — the
  // Brood is its own lineage, and letting Apex feed it would turn a
  // limited-time set into merge fodder.
  [speciesA, speciesB].forEach((sp) => {
    if (sp.rarity === 'apex') throw new BroodError('APEX_EXCLUDED', 'Apex droids cannot be merged');
    if (sp.collection === 'apex') throw new BroodError('APEX_EXCLUDED', 'Apex droids cannot be merged');
  });

  const bays = baysFor(playerId);
  const freeBay = bays.find((bay) => !bay.egg);
  if (!freeBay) {
    // Distinct messages: owning none is a different problem from having
    // them all full, and the fix differs too.
    throw new BroodError('NO_FREE_BAY', bays.length
      ? 'All your Genesis Bays are occupied — collect an egg first, or buy another Bay'
      : `You don't own a Genesis Bay yet — buy your first for ${BAY_BASE_COST.toLocaleString()} crystals`);
  }

  if ((player.crystalBalance || 0) < MERGE_COST_CRYSTALS) {
    throw new BroodError('NOT_ENOUGH_CRYSTALS', `Merging costs ${MERGE_COST_CRYSTALS.toLocaleString()} crystals`);
  }

  // Everything validated — now it's safe to destroy the parents.
  player.crystalBalance -= MERGE_COST_CRYSTALS;
  db.crystalTransactions.push({
    id: db.nextId(), playerId, amount: -MERGE_COST_CRYSTALS, source: 'brood_merge', createdAt: Date.now(),
  });

  const rarity = rollOutcomeRarity(speciesA.rarity, speciesB.rarity, playerId, keeperBonusFor(player));
  const pool = broodSpeciesByRarity(rarity);
  if (!pool.length) throw new BroodError('NO_BROOD_SPECIES', `No Astral Brood species defined for ${rarity}`);
  const result = pool[Math.floor(Math.random() * pool.length)];

  db.ownedDroids.delete(a.id);
  db.ownedDroids.delete(b.id);

  const now = Date.now();
  freeBay.egg = {
    id: db.nextId(),
    speciesId: result.id,
    rarity,
    // The species is hidden until it hatches — knowing in advance would
    // remove the entire reason to wait.
    startedAt: now,
    readyAt: now + HATCH_MS[rarity],
    parents: [speciesA.name, speciesB.name],
  };

  return {
    ...statusFor(playerId),
    merged: {
      parents: [speciesA.name, speciesB.name],
      rarity,
      readyAt: freeBay.egg.readyAt,
      hatchHours: Math.round(HATCH_MS[rarity] / (60 * 60 * 1000)),
    },
  };
}

function collect(playerId, bayId) {
  const player = db.players.get(playerId);
  if (!player) throw new BroodError('NO_PLAYER', 'Player not found');
  const bay = baysFor(playerId).find((x) => x.id === bayId);
  if (!bay) throw new BroodError('NO_BAY', 'Genesis Bay not found');
  if (!bay.egg) throw new BroodError('EMPTY_BAY', 'That Bay is empty');
  if (Date.now() < bay.egg.readyAt) {
    const mins = Math.ceil((bay.egg.readyAt - Date.now()) / 60000);
    throw new BroodError('NOT_READY', `Still incubating — about ${mins} minute${mins === 1 ? '' : 's'} left`);
  }

  const species = db.droidSpecies.find((s) => s.id === bay.egg.speciesId);
  const droid = {
    id: db.nextId(),
    playerId,
    speciesId: species.id,
    variant: db.rollVariant(species.rarity),
    level: 1,
    captureCost: 0,
    capturedAt: Date.now(),
    workshopSlotId: null,
    currentHpDamage: 0,
    hiddenFromTrade: false,
    fromBroodChamber: true,
  };
  db.ownedDroids.set(droid.id, droid);
  db.markDexSeen(playerId, species.id, droid.variant);
  levels.awardXp(playerId, 'hatch');

  bay.egg = null;
  return { ...statusFor(playerId), hatched: { name: species.name, rarity: species.rarity, variant: droid.variant, droidId: droid.id } };
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new BroodError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  const bays = baysFor(playerId);

  return {
    bays: bays.map((bay) => ({
      id: bay.id,
      occupied: Boolean(bay.egg),
      egg: bay.egg ? {
        rarity: bay.egg.rarity,
        parents: bay.egg.parents,
        readyAt: bay.egg.readyAt,
        ready: now >= bay.egg.readyAt,
        msRemaining: Math.max(0, bay.egg.readyAt - now),
      } : null,
    })),
    bayCount: bays.length,
    maxBays: MAX_BAYS,
    nextBayCost: nextBayCost(playerId),
    mergeCost: MERGE_COST_CRYSTALS,
    keeper: {
      unlocked: KEEPER_UNLOCKED,
      droidId: player.chamberKeeperDroidId || null,
      note: KEEPER_UNLOCKED ? null : 'Chamber Keeper needed',
    },
    broodDexComplete: hasCompleteBroodDex(playerId),
    hatchTimes: Object.fromEntries(Object.entries(HATCH_MS).map(([k, v]) => [k, Math.round(v / (60 * 60 * 1000))])),
  };
}

module.exports = {
  MERGE_COST_CRYSTALS,
  BAY_BASE_COST,
  BAY_COST_INCREMENT,
  MAX_BAYS,
  TIERS,
  HATCH_MS,
  UPGRADE_CHANCE_BY_COMBINED_TIER,
  GALACTIC_STEP_MULTIPLIER,
  BROOD_NAMES,
  KEEPER_UNLOCKED,
  merge,
  collect,
  buyBay,
  statusFor,
  nextBayCost,
  rollOutcomeRarity,
  hasCompleteBroodDex,
  broodSpeciesByRarity,
  BroodError,
};
