// workshop.js
//
// Compute-on-read accrual: no scheduled per-second tick job. Earnings are
// calculated from elapsed time whenever the player checks in (app open,
// workshop screen, or explicit collect action).

const db = require('./db');

const MAX_OFFLINE_HOURS = 10;

function levelMultiplier(level) {
  return 1 + (level - 1) * 0.15;
}

function speciesById(speciesId) {
  return db.droidSpecies.find((s) => s.id === speciesId);
}

// Crystals/minute for a single droid in its current slot — same formula
// used by calculateEarnings, exposed separately so the API/UI can show
// "what this droid farms" without waiting for a full accrual pass.
// (Rate basis is per-minute rather than per-hour so testing/leveling loops
// don't require a long real-world wait — same species baseCrystalRate
// numbers, just a faster clock.)
function droidCrystalsPerMinute(droid) {
  if (!droid.workshopSlotId) return 0;
  const slot = db.workshopSlots.get(droid.workshopSlotId);
  const species = speciesById(droid.speciesId);
  if (!slot || !species) return 0;
  const variantMultiplier = db.VARIANT_CRYSTAL_MULTIPLIER[droid.variant] ?? 1.0;
  return species.baseCrystalRate * levelMultiplier(droid.level) * slot.multiplier * variantMultiplier;
}

// Enriches a raw owned_droids row with species/rate info for API responses.
function enrichDroid(droid) {
  const species = speciesById(droid.speciesId);
  return {
    ...droid,
    speciesName: species?.name,
    rarity: species?.rarity,
    alignment: species?.alignment,
    crystalsPerMinute: Math.round(droidCrystalsPerMinute(droid) * 100) / 100,
    nextLevelCost: droid.level >= db.DROID_LEVEL_CAP ? null : db.levelUpCost(droid.level),
  };
}

// Core accrual calc — pure function, no side effects, so it's easy to test.
function calculateEarnings(playerId, now = Date.now()) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  const elapsedMs = now - player.lastCrystalCollection;
  const cappedMs = Math.min(elapsedMs, MAX_OFFLINE_HOURS * 60 * 60 * 1000);
  const elapsedMinutes = cappedMs / (60 * 1000);

  let earned = 0;
  for (const droid of db.ownedDroids.values()) {
    if (droid.playerId !== playerId || !droid.workshopSlotId) continue;
    const slot = db.workshopSlots.get(droid.workshopSlotId);
    const species = speciesById(droid.speciesId);
    if (!slot || !species) continue;

    const variantMultiplier = db.VARIANT_CRYSTAL_MULTIPLIER[droid.variant] ?? 1.0;
    earned += species.baseCrystalRate * levelMultiplier(droid.level) * slot.multiplier * variantMultiplier * elapsedMinutes;
  }

  return { earned: Math.floor(earned), elapsedMinutes };
}

// Settle: apply accrued earnings to the player's balance and reset the clock.
// Call this on app open, workshop view, explicit "collect", AND before any
// slot reassignment (so swapping droids can't retroactively inflate past earnings).
function settleEarnings(playerId, now = Date.now()) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  const { earned } = calculateEarnings(playerId, now);

  if (earned > 0) {
    player.crystalBalance += earned;
    db.crystalTransactions.push({
      id: db.nextId(),
      playerId,
      amount: earned,
      source: 'workshop_tick',
      createdAt: now,
    });
  }
  player.lastCrystalCollection = now;

  return { earned, crystalBalance: player.crystalBalance };
}

// Assign a droid to a workshop slot — settles first so rate changes only
// apply going forward, never retroactively.
function assignDroidToSlot(playerId, droidId, slotId) {
  settleEarnings(playerId); // lock in earnings under the OLD configuration first

  const droid = db.ownedDroids.get(droidId);
  const slot = db.workshopSlots.get(slotId);
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  if (!slot || slot.playerId !== playerId) throw new Error('Slot not found for player');
  if (!slot.unlocked) throw new Error('Slot is locked');

  // Reject if another droid already occupies this slot — each slot holds
  // exactly one droid. (Previously unenforced: this let players stack
  // unlimited droids into a single slot, bypassing the slot-unlock economy.)
  const occupant = [...db.ownedDroids.values()].find(
    (d) => d.playerId === playerId && d.workshopSlotId === slotId && d.id !== droidId
  );
  if (occupant) {
    throw new Error(`Slot already occupied by another droid (#${occupant.id}) — unassign it first`);
  }

  droid.workshopSlotId = slotId;
  return droid;
}

function unassignDroid(playerId, droidId) {
  settleEarnings(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  droid.workshopSlotId = null;
  return droid;
}

// Buy an extra farming slot with crystals. Settles first so the cost is
// paid from an up-to-date balance, not a stale one.
function unlockSlot(playerId, slotId) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  const slot = db.workshopSlots.get(slotId);
  if (!slot || slot.playerId !== playerId) throw new Error('Slot not found for player');
  if (slot.unlocked) throw new Error('Slot is already unlocked');

  const cost = db.slotUnlockCost(slot.slotIndex);
  if (player.crystalBalance < cost) {
    throw new Error(`Not enough crystals — unlocking this slot costs ${cost}`);
  }

  player.crystalBalance -= cost;
  db.crystalTransactions.push({
    id: db.nextId(),
    playerId,
    amount: -cost,
    source: 'slot_unlock',
    createdAt: Date.now(),
  });
  slot.unlocked = true;

  return { slot, cost, crystalBalance: player.crystalBalance, settledEarned: settled.earned };
}

// Spend crystals to level up an individual droid — increases its crystal
// production via levelMultiplier above. Settles first so the droid's OLD
// rate is credited before the level (and thus its rate) changes.
function levelUpDroid(playerId, droidId) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  if (droid.level >= db.DROID_LEVEL_CAP) throw new Error(`Droid is already at the level cap (${db.DROID_LEVEL_CAP})`);

  const cost = db.levelUpCost(droid.level);
  if (player.crystalBalance < cost) {
    throw new Error(`Not enough crystals — leveling up costs ${cost}`);
  }

  player.crystalBalance -= cost;
  db.crystalTransactions.push({
    id: db.nextId(),
    playerId,
    amount: -cost,
    source: 'droid_level_up',
    createdAt: Date.now(),
  });
  droid.level += 1;

  return { droid: enrichDroid(droid), cost, crystalBalance: player.crystalBalance, settledEarned: settled.earned };
}

// Spend crystals to upgrade the control pad itself (account-wide, not
// per-droid) — raises critical-capture chance and the accuracy-skill
// ceiling. Settles first purely for balance freshness/consistency with
// the other spend actions above.
function upgradePad(playerId) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  const cost = db.padUpgradeCost(player.padLevel);
  if (player.crystalBalance < cost) {
    throw new Error(`Not enough crystals — upgrading the pad costs ${cost}`);
  }

  player.crystalBalance -= cost;
  db.crystalTransactions.push({
    id: db.nextId(),
    playerId,
    amount: -cost,
    source: 'pad_upgrade',
    createdAt: Date.now(),
  });
  player.padLevel += 1;

  return {
    padLevel: player.padLevel,
    critChance: db.critChanceForPadLevel(player.padLevel),
    cost,
    crystalBalance: player.crystalBalance,
    settledEarned: settled.earned,
  };
}

module.exports = {
  calculateEarnings,
  settleEarnings,
  assignDroidToSlot,
  unassignDroid,
  unlockSlot,
  levelUpDroid,
  upgradePad,
  droidCrystalsPerMinute,
  enrichDroid,
  MAX_OFFLINE_HOURS,
};
