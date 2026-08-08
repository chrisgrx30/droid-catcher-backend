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
  if (droid.isTitan) {
    return {
      id: droid.id,
      speciesName: droid.titanName,
      rarity: 'galactic',
      alignment: 'cosmic',
      variant: 'standard',
      level: 1,
      hp: droid.titanHp,
      attack: droid.titanAttack,
      currentHp: Math.max(0, droid.titanHp - (droid.currentHpDamage || 0)),
      fainted: (droid.currentHpDamage || 0) >= droid.titanHp,
      isTitan: true,
    };
  }
  const species = speciesById(droid.speciesId);
  const lvlMult = levelMultiplier(droid.level);
  const evolution = db.EVOLUTION_TABLE[droid.speciesId];
  const evolvesToSpecies = evolution ? speciesById(evolution.evolvesTo) : null;
  const now = Date.now();
  const buffIsActive = droid.buffActiveUntil ? now < droid.buffActiveUntil : false;
  const buffIsOnCooldown = !buffIsActive && droid.buffCooldownUntil ? now < droid.buffCooldownUntil : false;
  return {
    ...droid,
    speciesName: species?.name,
    rarity: species?.rarity,
    alignment: species?.alignment,
    isCompanion: species?.isCompanion || false,
    companionBuffType: species?.companionBuffType || null,
    companionBuffPercent: species?.companionBuffPercent || null,
    buffIsActive,
    buffIsOnCooldown,
    crystalsPerMinute: Math.round(droidCrystalsPerMinute(droid) * 100) / 100,
    hp: species ? Math.round(species.baseHP * lvlMult) : null,
    attack: species ? Math.round(species.baseAttack * lvlMult) : null,
    currentHp: species ? Math.max(0, Math.round(species.baseHP * lvlMult) - (droid.currentHpDamage || 0)) : null,
    fainted: species ? (droid.currentHpDamage || 0) >= Math.round(species.baseHP * lvlMult) : false,
    nextLevelCost: droid.level >= db.DROID_LEVEL_CAP ? null : db.levelUpCost(droid.level, species?.rarity),
    evolvesToName: evolvesToSpecies?.name || null,
    evolveNovaChipCost: evolution?.novaChipCost || null,
    isEvolutionOnly: species?.isEvolutionOnly || false,
    masteryNextTierName: db.SCAFFITAN_MASTERY_TABLE[droid.speciesId] ? speciesById(db.SCAFFITAN_MASTERY_TABLE[droid.speciesId].masterTo)?.name : null,
    masteryTubeCost: db.SCAFFITAN_MASTERY_TABLE[droid.speciesId]?.tubeCost || null,
  };
}

// Companion buff: whichever droid is currently equipped (player.companionDroidId)
// adds a flat % to the player's TOTAL crystal production — it doesn't farm
// itself and never occupies a workshop slot.
function companionBuffMultiplier(playerId) {
  const player = db.players.get(playerId);
  if (!player || !player.companionDroidId) return 1;
  const droid = db.ownedDroids.get(player.companionDroidId);
  if (!droid || droid.playerId !== playerId) return 1;
  const species = speciesById(droid.speciesId);
  if (!species || !species.isCompanion || species.companionBuffType !== 'crystal') return 1;
  if (!droid.buffActiveUntil || Date.now() >= droid.buffActiveUntil) return 1; // must be actively activated, not just equipped
  return 1 + species.companionBuffPercent / 100;
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
  earned *= companionBuffMultiplier(playerId);

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

  const species = speciesById(droid.speciesId);
  const cost = db.levelUpCost(droid.level, species?.rarity);
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
  const nextLevel = player.padLevel + 1;
  const needsRam = db.padRequiresRam(nextLevel);

  if (player.crystalBalance < cost) {
    throw new Error(`Not enough crystals — upgrading the pad costs ${cost}`);
  }
  if (needsRam && player.padRam < 1) {
    throw new Error(`Level ${nextLevel} also needs 1 Pad RAM — buy one from the Shop`);
  }

  player.crystalBalance -= cost;
  db.crystalTransactions.push({
    id: db.nextId(),
    playerId,
    amount: -cost,
    source: 'pad_upgrade',
    createdAt: Date.now(),
  });
  if (needsRam) player.padRam -= 1;
  player.padLevel += 1;

  return {
    padLevel: player.padLevel,
    critChance: db.critChanceForPadLevel(player.padLevel),
    cost,
    crystalBalance: player.crystalBalance,
    settledEarned: settled.earned,
  };
}

// Release a droid for scrap: refunds 1.5x whatever it cost to capture (0
// for free/starter droids), with a 10% chance of also dropping a Nova
// Chip (spent on species evolution — see evolveSpecies). Frees up its
// workshop slot and clears it as the active companion if applicable.
// RELEASE_REFUND_MULTIPLIER now lives in db.js (shared with capture.js)
const NOVA_CHIP_DROP_CHANCE = 0.10;

// Weighted so 1 is most likely, per confirmed design ("1 being a
// higher probability") — exact weights aren't specified beyond that,
// so this is my own reasonable curve, easy to retune.
const SCAFFITAN_RELEASE_TUBE_WEIGHTS = [
  { tubes: 1, weight: 40 },
  { tubes: 2, weight: 25 },
  { tubes: 3, weight: 18 },
  { tubes: 4, weight: 10 },
  { tubes: 5, weight: 7 },
];
function rollScaffitanReleaseTubes() {
  const totalWeight = SCAFFITAN_RELEASE_TUBE_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of SCAFFITAN_RELEASE_TUBE_WEIGHTS) {
    if (roll < entry.weight) return entry.tubes;
    roll -= entry.weight;
  }
  return 1; // fallback, should never hit given the loop above sums to totalWeight
}

function releaseDroid(playerId, droidId) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  const species = db.droidSpecies.find((s) => s.id === droid.speciesId);

  if (species && species.collection === 'titan') {
    // Scaffitan release: Tubes instead of a crystal refund, since
    // captureCost is 0 for a battle-won Scaffitan — a normal refund
    // would always be worthless.
    const tubesGranted = rollScaffitanReleaseTubes();
    player.energyTubes = (player.energyTubes || 0) + tubesGranted;
    if (player.companionDroidId === droidId) player.companionDroidId = null;
    db.ownedDroids.delete(droidId);
    return { refund: 0, gotNovaChip: false, novaChips: player.novaChips, crystalBalance: player.crystalBalance, settledEarned: settled.earned, scaffitanTubesGranted: tubesGranted, energyTubes: player.energyTubes };
  }

  const refund = Math.floor((droid.captureCost || 0) * db.RELEASE_REFUND_MULTIPLIER);
  player.crystalBalance += refund;
  if (refund > 0) {
    db.crystalTransactions.push({ id: db.nextId(), playerId, amount: refund, source: 'droid_release', createdAt: Date.now() });
  }

  const gotNovaChip = Math.random() < NOVA_CHIP_DROP_CHANCE;
  if (gotNovaChip) player.novaChips += 1;

  if (player.companionDroidId === droidId) player.companionDroidId = null;
  db.ownedDroids.delete(droidId);

  return { refund, gotNovaChip, novaChips: player.novaChips, crystalBalance: player.crystalBalance, settledEarned: settled.earned };
}

// Bulk release: settles earnings ONCE for the whole batch (not once per
// droid) and returns a single summed result, so a multi-select release in
// the UI reads as one action with one outcome, not N separate ones.
function releaseDroidsBulk(playerId, droidIds) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  let totalRefund = 0;
  let novaChipsGained = 0;
  const releasedNames = [];
  const skipped = [];

  for (const droidId of droidIds) {
    const droid = db.ownedDroids.get(droidId);
    if (!droid || droid.playerId !== playerId) {
      skipped.push(droidId);
      continue;
    }
    const species = speciesById(droid.speciesId);
    const refund = Math.floor((droid.captureCost || 0) * db.RELEASE_REFUND_MULTIPLIER);
    totalRefund += refund;
    if (Math.random() < NOVA_CHIP_DROP_CHANCE) novaChipsGained += 1;
    if (player.companionDroidId === droidId) player.companionDroidId = null;
    releasedNames.push(species?.name || 'Unknown');
    db.ownedDroids.delete(droidId);
  }

  player.crystalBalance += totalRefund;
  if (totalRefund > 0) {
    db.crystalTransactions.push({ id: db.nextId(), playerId, amount: totalRefund, source: 'droid_release_bulk', createdAt: Date.now() });
  }
  player.novaChips += novaChipsGained;

  return {
    releasedCount: releasedNames.length,
    releasedNames,
    skipped,
    totalRefund,
    novaChipsGained,
    novaChips: player.novaChips,
    crystalBalance: player.crystalBalance,
    settledEarned: settled.earned,
  };
}

// Species evolution (e.g. Leafkin -> Bushy): spends Nova Chips, swaps the
// droid's speciesId in place — keeps its level/variant/slot, just becomes
// a stronger species going forward.
function masterScaffitan(playerId, droidId) {
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');

  const mastery = db.SCAFFITAN_MASTERY_TABLE[droid.speciesId];
  if (!mastery) throw new Error('This Scaffitan is already fully mastered, or isn\'t a Scaffitan');
  if ((player.energyTubes || 0) < mastery.tubeCost) {
    throw new Error(`Not enough Energy Tubes — mastering this tier costs ${mastery.tubeCost}`);
  }

  player.energyTubes -= mastery.tubeCost;
  droid.speciesId = mastery.masterTo;
  db.markDexSeen(playerId, mastery.masterTo, droid.variant);

  return { droid: enrichDroid(droid), energyTubes: player.energyTubes };
}

function healDroid(playerId, droidId) {
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  const enriched = enrichDroid(droid);
  if (!enriched.fainted) throw new Error('This droid isn\'t fainted — nothing to heal');
  if (player.repairKits < 1) throw new Error('No Repair Kits owned — buy one from the Shop');

  player.repairKits -= 1;
  droid.currentHpDamage = 0;
  return { droid: enrichDroid(droid), repairKits: player.repairKits };
}

function evolveSpecies(playerId, droidId) {
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');

  const evolution = db.EVOLUTION_TABLE[droid.speciesId];
  if (!evolution) throw new Error('This species has no evolution available');
  if (player.novaChips < evolution.novaChipCost) {
    throw new Error(`Not enough Nova Chips — evolving costs ${evolution.novaChipCost}`);
  }
  if (evolution.extraCrystalCost && player.crystalBalance < evolution.extraCrystalCost) {
    throw new Error(`Not enough crystals — this evolution also needs ${evolution.extraCrystalCost}`);
  }
  if (evolution.extraMaterial) {
    const owned = player[evolution.extraMaterial] || 0;
    if (owned < evolution.extraMaterialCost) {
      throw new Error(`Not enough ${evolution.extraMaterial} — this evolution needs ${evolution.extraMaterialCost}`);
    }
  }

  // All validated — now actually deduct everything.
  player.novaChips -= evolution.novaChipCost;
  if (evolution.extraCrystalCost) {
    player.crystalBalance -= evolution.extraCrystalCost;
    db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -evolution.extraCrystalCost, source: 'species_evolution', createdAt: Date.now() });
  }
  if (evolution.extraMaterial) {
    player[evolution.extraMaterial] -= evolution.extraMaterialCost;
  }
  droid.speciesId = evolution.evolvesTo;
  db.markDexSeen(playerId, evolution.evolvesTo, droid.variant);

  return { droid: enrichDroid(droid), novaChips: player.novaChips, crystalBalance: player.crystalBalance };
}

// Paint evolution (Rusty -> Funky): spends banked Paint, sets a cosmetic
// primary color, and bumps the crystal multiplier to the Funky tier.
function evolveFunky(playerId, droidId, color) {
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  if (droid.variant !== 'rusty') throw new Error('Only Rusty droids can be painted Funky');
  if (!db.PRIMARY_COLORS.includes(color)) throw new Error(`Color must be one of: ${db.PRIMARY_COLORS.join(', ')}`);
  if (player.paint < db.FUNKY_EVOLVE_PAINT_COST) {
    throw new Error(`Not enough Paint — evolving costs ${db.FUNKY_EVOLVE_PAINT_COST}`);
  }

  player.paint -= db.FUNKY_EVOLVE_PAINT_COST;
  droid.variant = 'funky';
  droid.color = color;
  db.markDexSeen(playerId, droid.speciesId, 'funky', color);

  return { droid: enrichDroid(droid), paint: player.paint };
}

// Companion slot — separate from workshop slots entirely. Only one can be
// active ("held") at a time; capturing more just leaves them unequipped.
function assignCompanion(playerId, droidId) {
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!player) throw new Error('Player not found');
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  const species = speciesById(droid.speciesId);
  if (!species || !species.isCompanion) throw new Error('That droid is not a companion species');

  player.companionDroidId = droidId;
  return { droid: enrichDroid(droid), buffType: species.companionBuffType, buffPercent: species.companionBuffPercent };
}

// Capture-rate-type companion buff (e.g. Nebulfox) — multiplies the
// computed success chance in capture.js, distinct from the crystal-farm
// buff above. Separate function since it's consumed by a different module.
function companionCaptureRateMultiplier(playerId) {
  const player = db.players.get(playerId);
  if (!player || !player.companionDroidId) return 1;
  const droid = db.ownedDroids.get(player.companionDroidId);
  if (!droid || droid.playerId !== playerId) return 1;
  const species = speciesById(droid.speciesId);
  if (!species || !species.isCompanion || species.companionBuffType !== 'capture_rate') return 1;
  if (!droid.buffActiveUntil || Date.now() >= droid.buffActiveUntil) return 1; // must be actively toggled on, not just equipped
  return 1 + species.companionBuffPercent / 100;
}

function unassignCompanion(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  player.companionDroidId = null;
  return { companionDroidId: null };
}

// Cosmetic purchase — pure crystal sink, no gameplay effect.
function buyCosmetic(playerId, cosmeticId) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  const item = db.COSMETICS_CATALOG.find((c) => c.id === cosmeticId);
  if (!item) throw new Error('Unknown cosmetic');
  if (player.cosmetics.includes(cosmeticId)) throw new Error('Already owned');
  if (player.crystalBalance < item.cost) throw new Error(`Not enough crystals — costs ${item.cost}`);

  player.crystalBalance -= item.cost;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -item.cost, source: 'cosmetic_purchase', createdAt: Date.now() });
  player.cosmetics.push(cosmeticId);

  return { cosmetics: player.cosmetics, crystalBalance: player.crystalBalance, settledEarned: settled.earned };
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
  companionBuffMultiplier,
  companionCaptureRateMultiplier,
  enrichDroid,
  releaseDroid,
  releaseDroidsBulk,
  evolveSpecies,
  healDroid,
  masterScaffitan,
  evolveFunky,
  assignCompanion,
  unassignCompanion,
  buyCosmetic,
  MAX_OFFLINE_HOURS,
};
