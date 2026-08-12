// smugglersrun.js
//
// SMUGGLER'S RUN — the idle half of Space Exploration.
//
// Space Rift is active play: you walk, you fight, you decide. This is
// its opposite — you commit droids and crystals, close the app, and
// collect later. The two sit on one tab because they're the same
// fantasy from different angles.
//
// HOW A RUN WORKS
//   1. Pick a tier: Common, Uncommon, Rare or Legendary.
//   2. Send 1-4 droids. Their RARITY cuts the wait: a Common droid
//      trims 10%, Uncommon 20%, Rare 30%, Legendary 40%. Sending your
//      best droids is a real cost — they can't farm or battle while
//      away — so speed is bought with opportunity, not crystals.
//   3. Optionally invest crystals. More crystals means more loot, with
//      DIMINISHING returns so it can't be turned into a printer.
//   4. Collect when the timer ends.
//
// THE DROID-DROP RULE
// A run can return a droid of its own tier, but only if at least one
// droid you SENT matches or exceeds that tier. You can't fish for a
// Legendary by sending four commons — the risk has to match the prize.

const db = require('./db');

const MAX_DROIDS = 4;
const MIN_DROIDS = 1;

// Base durations. Deliberately spread so the tiers feel different:
// a Common run is a lunch break, a Legendary is overnight.
const TIERS = {
  common: {
    id: 'common', name: 'Common Run', hours: 1,
    minCrystals: 0, maxCrystals: 5000,
    lootRolls: 2, materialTier: 'basic',
    droidChance: 0.10, rareMaterialChance: 0,
  },
  uncommon: {
    id: 'uncommon', name: 'Uncommon Run', hours: 2,
    minCrystals: 500, maxCrystals: 15000,
    lootRolls: 3, materialTier: 'basic',
    droidChance: 0.08, rareMaterialChance: 0,
  },
  rare: {
    id: 'rare', name: 'Rare Run', hours: 3,
    minCrystals: 2000, maxCrystals: 40000,
    lootRolls: 4, materialTier: 'good',
    droidChance: 0.06, rareMaterialChance: 0.04,
  },
  legendary: {
    id: 'legendary', name: 'Legendary Run', hours: 4,
    minCrystals: 10000, maxCrystals: 100000,
    lootRolls: 5, materialTier: 'best',
    droidChance: 0.04, rareMaterialChance: 0.12,
  },
};
const TIER_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

// Speed-up per droid sent, by that droid's rarity.
const SPEED_BY_RARITY = {
  common: 0.10, uncommon: 0.20, rare: 0.30, legendary: 0.40,
  cosmic: 0.40, galactic: 0.40, apex: 0.40,
};
// Four legendaries would otherwise erase the timer entirely.
const MAX_SPEEDUP = 0.65;

// Loot pools by tier. Attachments and battle items are the draw —
// they're otherwise Depot-only, so this gives them a second route.
const MATERIAL_POOLS = {
  basic: ['paint', 'novaChips', 'repairKits', 'energyTubes'],
  good: ['paint', 'novaChips', 'repairKits', 'beacons', 'padRam', 'augmentCores'],
  best: ['novaChips', 'beacons', 'padRam', 'augmentCores', 'emps', 'apexCubes'],
};
const RARE_MATERIALS = ['lightStones', 'darkCrystals'];

class RunError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function activeRun(player) {
  const r = player.smugglerRun;
  return r && r.status === 'active' ? r : null;
}

function durationMsFor(tierId, droids) {
  const tier = TIERS[tierId];
  const speedup = Math.min(
    MAX_SPEEDUP,
    droids.reduce((a, d) => a + (SPEED_BY_RARITY[d.rarity] || 0.10), 0)
  );
  return {
    ms: Math.round(tier.hours * 3600000 * (1 - speedup)),
    speedup,
  };
}

function start(playerId, tierId, droidIds, crystalsInvested) {
  const player = db.players.get(playerId);
  if (!player) throw new RunError('NO_PLAYER', 'Player not found');
  if (activeRun(player)) throw new RunError('IN_PROGRESS', 'You already have a Smuggler\'s Run out');
  const tier = TIERS[tierId];
  if (!tier) throw new RunError('BAD_TIER', 'Unknown run tier');
  if (!Array.isArray(droidIds) || droidIds.length < MIN_DROIDS || droidIds.length > MAX_DROIDS) {
    throw new RunError('BAD_TEAM', `Send between ${MIN_DROIDS} and ${MAX_DROIDS} droids`);
  }

  const workshop = require('./workshop');
  const droids = droidIds.map((id) => {
    const d = db.ownedDroids.get(id);
    if (!d || d.playerId !== playerId) throw new RunError('NO_DROID', 'One of those droids is not yours');
    if (d.fortId) throw new RunError('IN_FORT', 'A garrisoned droid cannot be sent');
    if (d.workshopSlotId) throw new RunError('IN_WORKSHOP', 'Remove the droid from its workshop slot first');
    if (d.smugglerRun) throw new RunError('ALREADY_OUT', 'That droid is already on a run');
    const e = workshop.enrichDroid(d);
    return { droidId: d.id, name: e.speciesName, rarity: e.rarity, level: e.level };
  });

  const spend = Math.max(0, Math.floor(Number(crystalsInvested) || 0));
  if (spend < tier.minCrystals) {
    throw new RunError('TOO_LITTLE', `A ${tier.name} needs at least ${tier.minCrystals.toLocaleString()} crystals`);
  }
  if (spend > tier.maxCrystals) {
    throw new RunError('TOO_MUCH', `The most a ${tier.name} can carry is ${tier.maxCrystals.toLocaleString()} crystals`);
  }
  if ((player.crystalBalance || 0) < spend) throw new RunError('NOT_ENOUGH_CRYSTALS', 'Not enough crystals');

  if (spend) {
    player.crystalBalance -= spend;
    db.crystalTransactions.push({
      id: db.nextId(), playerId, amount: -spend, source: 'smuggler_run', createdAt: Date.now(),
    });
  }

  // Lock the droids so they can't farm, battle or merge while away.
  droids.forEach((d) => { db.ownedDroids.get(d.droidId).smugglerRun = true; });

  const { ms, speedup } = durationMsFor(tierId, droids);
  const now = Date.now();
  player.smugglerRun = {
    tierId,
    status: 'active',
    droids,
    crystalsInvested: spend,
    startedAt: now,
    readyAt: now + ms,
    speedup,
  };
  return statusFor(playerId);
}

// Loot is rolled at COLLECTION, not at launch — otherwise the result
// would sit in the save waiting to be read by anyone poking at the API.
function rollLoot(run) {
  const tier = TIERS[run.tierId];
  const out = { crystals: 0, materials: {}, attachments: [], droid: null, rareMaterials: {} };

  // CRYSTALS: measured a first pass where a minimum-investment Uncommon
  // run returned 5.5x its stake. That made the optimal play "invest
  // nothing", which defeats the whole mechanic — and at scale it was a
  // crystal printer.
  //
  // Crystals now return slightly UNDER what you put in at every level.
  // What investment actually buys is LOOT: more material rolls, better
  // droid odds, better rare-material odds. The run is a converter from
  // crystals into items, not an interest account.
  const invested = run.crystalsInvested;
  const rank = TIER_ORDER.indexOf(run.tierId);
  const base = 500 * (rank + 1);                       // paid for sending droids at all
  const investReturn = Math.round(invested * 0.75);    // always a loss on crystals alone
  out.crystals = base + investReturn + Math.floor(Math.random() * base);

  // How fully the run was funded, 0..1 — this is what investment buys.
  const fill = tier.maxCrystals ? Math.min(1, invested / tier.maxCrystals) : 0;

  const bonusRolls = Math.round(fill * 4);
  const rolls = tier.lootRolls + bonusRolls;

  const pool = MATERIAL_POOLS[tier.materialTier];
  for (let i = 0; i < rolls; i++) {
    const mat = pool[Math.floor(Math.random() * pool.length)];
    const amt = 1 + Math.floor(Math.random() * (TIER_ORDER.indexOf(run.tierId) + 2));
    out.materials[mat] = (out.materials[mat] || 0) + amt;
  }

  // Attachments — a second route for items that were Depot-only.
  try {
    const attachments = require('./attachments');
    const chance = 0.15 + rank * 0.10 + fill * 0.35;
    if (Math.random() < chance) {
      const tierWeights = { common: 60, uncommon: 30, rare: 10 };
      const cat = attachments.ATTACHMENT_CATALOG;
      const total = cat.reduce((a, it) => a + (tierWeights[it.rarity] || 1), 0);
      let roll = Math.random() * total;
      let picked = cat[cat.length - 1];
      for (const item of cat) { roll -= (tierWeights[item.rarity] || 1); if (roll <= 0) { picked = item; break; } }
      out.attachments.push({ id: picked.id, name: picked.name, rarity: picked.rarity, icon: picked.icon });
    }
  } catch (e) {}

  // Rare materials — Rare and Legendary runs only.
  if (tier.rareMaterialChance && Math.random() < tier.rareMaterialChance * (1 + fill * 2)) {
    const m = RARE_MATERIALS[Math.floor(Math.random() * RARE_MATERIALS.length)];
    out.rareMaterials[m] = 1;
  }

  // Droid drop. Gated on having sent something of matching rarity or
  // better — you can't fish for a Legendary with four commons.
  const runRank = rank;
  const bestSent = run.droids.reduce((max, d) => {
    const r = TIER_ORDER.indexOf(d.rarity);
    return Math.max(max, r === -1 ? 3 : r); // cosmic/galactic/apex count as top
  }, -1);
  if (bestSent >= runRank && Math.random() < tier.droidChance * (1 + fill * 2.5)) {
    const candidates = db.droidSpecies.filter((s) =>
      s.rarity === run.tierId && s.spawnWeight > 0 && !s.eventOnly);
    if (candidates.length) {
      const sp = candidates[Math.floor(Math.random() * candidates.length)];
      out.droid = { speciesId: sp.id, name: sp.name, rarity: sp.rarity };
    }
  }

  return out;
}

function collect(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RunError('NO_PLAYER', 'Player not found');
  const run = activeRun(player);
  if (!run) throw new RunError('NO_RUN', 'You have no run out');
  if (Date.now() < run.readyAt) {
    const mins = Math.ceil((run.readyAt - Date.now()) / 60000);
    throw new RunError('NOT_READY', `Still out — about ${mins} minute${mins === 1 ? '' : 's'} to go`);
  }

  const loot = rollLoot(run);

  player.crystalBalance = (player.crystalBalance || 0) + loot.crystals;
  db.crystalTransactions.push({
    id: db.nextId(), playerId, amount: loot.crystals, source: 'smuggler_return', createdAt: Date.now(),
  });
  Object.entries(loot.materials).forEach(([k, v]) => { player[k] = (player[k] || 0) + v; });
  Object.entries(loot.rareMaterials).forEach(([k, v]) => { player[k] = (player[k] || 0) + v; });
  loot.attachments.forEach((a) => {
    try { require('./attachments').grant(playerId, a.id); } catch (e) {}
  });
  if (loot.droid) {
    const d = {
      id: db.nextId(), playerId, speciesId: loot.droid.speciesId,
      variant: 'standard', level: 1, captureCost: 0, capturedAt: Date.now(),
      workshopSlotId: null, currentHpDamage: 0, hiddenFromTrade: false, fromSmuggler: true,
    };
    db.ownedDroids.set(d.id, d);
    db.markDexSeen(playerId, loot.droid.speciesId, 'standard');
  }

  // Release the droids.
  run.droids.forEach((d) => {
    const dr = db.ownedDroids.get(d.droidId);
    if (dr) dr.smugglerRun = false;
  });

  player.smugglerRun = null;
  player.smugglerHistory = player.smugglerHistory || [];
  player.smugglerHistory.unshift({ at: Date.now(), tierId: run.tierId, ...loot });
  if (player.smugglerHistory.length > 8) player.smugglerHistory.length = 8;

  return { loot, ...statusFor(playerId) };
}

function recall(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RunError('NO_PLAYER', 'Player not found');
  const run = activeRun(player);
  if (!run) throw new RunError('NO_RUN', 'You have no run out');
  // Recalling forfeits the invested crystals — that's the cost of
  // changing your mind, and it stops a run being a free droid-park.
  run.droids.forEach((d) => {
    const dr = db.ownedDroids.get(d.droidId);
    if (dr) dr.smugglerRun = false;
  });
  player.smugglerRun = null;
  return { recalled: true, crystalsLost: run.crystalsInvested, ...statusFor(playerId) };
}

function candidates(playerId) {
  const workshop = require('./workshop');
  return [...db.ownedDroids.values()]
    .filter((d) => d.playerId === playerId && !d.fortId && !d.workshopSlotId && !d.smugglerRun)
    .map((d) => {
      const e = workshop.enrichDroid(d);
      return {
        id: d.id, name: e.speciesName, rarity: e.rarity, level: e.level,
        speedup: Math.round((SPEED_BY_RARITY[e.rarity] || 0.10) * 100),
      };
    })
    .sort((a, b) => b.speedup - a.speedup || b.level - a.level);
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RunError('NO_PLAYER', 'Player not found');
  const run = activeRun(player);
  const now = Date.now();

  return {
    active: Boolean(run),
    run: run ? {
      tierId: run.tierId,
      tierName: TIERS[run.tierId].name,
      droids: run.droids,
      crystalsInvested: run.crystalsInvested,
      startedAt: run.startedAt,
      readyAt: run.readyAt,
      ready: now >= run.readyAt,
      msRemaining: Math.max(0, run.readyAt - now),
      speedupPercent: Math.round(run.speedup * 100),
    } : null,
    tiers: TIER_ORDER.map((id) => {
      const t = TIERS[id];
      return {
        id, name: t.name, hours: t.hours,
        minCrystals: t.minCrystals, maxCrystals: t.maxCrystals,
        lootRolls: t.lootRolls,
        droidChancePercent: Math.round(t.droidChance * 100),
        rareMaterialPercent: Math.round(t.rareMaterialChance * 100),
        materials: MATERIAL_POOLS[t.materialTier],
      };
    }),
    maxDroids: MAX_DROIDS,
    speedByRarity: SPEED_BY_RARITY,
    maxSpeedupPercent: Math.round(MAX_SPEEDUP * 100),
    history: (player.smugglerHistory || []).slice(0, 5),
  };
}

module.exports = {
  TIERS, TIER_ORDER, SPEED_BY_RARITY, MAX_DROIDS, MAX_SPEEDUP,
  start, collect, recall, candidates, statusFor, durationMsFor, rollLoot,
  RunError,
};
