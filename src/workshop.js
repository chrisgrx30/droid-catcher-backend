// workshop.js
//
// Compute-on-read accrual: no scheduled per-second tick job. Earnings are
// calculated from elapsed time whenever the player checks in (app open,
// workshop screen, or explicit collect action).

const db = require('./db');

const MAX_OFFLINE_HOURS = 4; // confirmed cap — was 10 hours at full rate, now 4 hours at OFFLINE_RATE_MULTIPLIER
const OFFLINE_RATE_MULTIPLIER = 0.30; // confirmed — crystals accrue at 30% of the normal rate once offline

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

// Same formula, but assuming a base (1.0) slot multiplier — used to show
// "what this droid would earn if assigned" for droids sitting unassigned
// in the Warehouse, where the real crystalsPerMinute is always 0 and
// therefore uninformative for comparing droids.
function droidPotentialCrystalsPerMinute(droid) {
  const species = speciesById(droid.speciesId);
  if (!species) return 0;
  const variantMultiplier = db.VARIANT_CRYSTAL_MULTIPLIER[droid.variant] ?? 1.0;
  return species.baseCrystalRate * levelMultiplier(droid.level) * variantMultiplier;
}

// Enriches a raw owned_droids row with species/rate info for API responses.
// Every buff currently affecting a player, for the Player tab summary
// box. Deliberately honest about what's real vs. not built yet —
// Cosmetics/Attachments buffs don't exist in the economy yet even
// though the Wardrobe UI does, so they show as inactive placeholders
// rather than being left out entirely (so the box is ready the moment
// those systems ship, without needing to rebuild this function).
function getPlayerBuffsSummary(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  const buffs = [
    { label: 'Crystal Gain', value: null, active: false },
    { label: 'Capture Rate', value: null, active: false },
    { label: 'Attack (Battle)', value: null, active: false },
    { label: 'HP', value: null, active: false, note: 'No HP buff exists yet' },
    { label: 'Cosmetics', value: null, active: false, note: 'Wardrobe items have no effect yet' },
    { label: 'Attachments', value: null, active: false, note: 'Not built yet' },
  ];

  if (player.companionDroidId) {
    const companion = db.ownedDroids.get(player.companionDroidId);
    if (companion) {
      const enriched = enrichDroid(companion);
      if (enriched.buffIsActive) {
        const percent = enriched.companionBuffPercent;
        if (enriched.companionBuffType === 'crystal') {
          buffs[0].value = `+${percent}%`;
          buffs[0].active = true;
        } else if (enriched.companionBuffType === 'capture_rate') {
          buffs[1].value = `+${percent}%`;
          buffs[1].active = true;
        } else if (enriched.companionBuffType === 'damage') {
          buffs[2].value = `+${percent}%`;
          buffs[2].active = true;
        }
      }
    }
  }

  return { buffs };
}

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
    potentialCrystalsPerMinute: Math.round(droidPotentialCrystalsPerMinute(droid) * 100) / 100,
    hp: species ? Math.round(species.baseHP * lvlMult) : null,
    attack: species ? Math.round(species.baseAttack * lvlMult) : null,
    currentHp: species ? Math.max(0, Math.round(species.baseHP * lvlMult) - (droid.currentHpDamage || 0)) : null,
    fainted: species ? (droid.currentHpDamage || 0) >= Math.round(species.baseHP * lvlMult) : false,
    // Apex droids cost cubes, everything else costs crystals. Both come
    // back through nextLevelCost so the UI stays one code path — the
    // currency flag below tells it which symbol to show.
    nextLevelCost: droid.level >= db.DROID_LEVEL_CAP
      ? null
      : (db.isApexSpecies(species) ? db.apexCubeLevelUpCost(droid.level) : db.levelUpCost(droid.level, species?.rarity)),
    nextLevelCurrency: db.isApexSpecies(species) ? 'apexCubes' : 'crystals',
    isApex: db.isApexSpecies(species),
    evolvesToName: evolvesToSpecies?.name || null,
    evolveNovaChipCost: evolution?.novaChipCost || null,
    isEvolutionOnly: species?.isEvolutionOnly || false,
    hiddenFromTrade: droid.hiddenFromTrade || false,
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
// For the Player tab display: "if you went offline right now, here's
// what you'd earn." Computed the same way real offline earnings are
// (same rate, same 4-hour cap), just projected forward instead of
// backward from an actual elapsed gap.
function calculateOfflineProjection(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  let ratePerMinute = 0;
  for (const droid of db.ownedDroids.values()) {
    if (droid.playerId !== playerId || !droid.workshopSlotId) continue;
    const slot = db.workshopSlots.get(droid.workshopSlotId);
    const species = speciesById(droid.speciesId);
    if (!slot || !species) continue;
    const variantMultiplier = db.VARIANT_CRYSTAL_MULTIPLIER[droid.variant] ?? 1.0;
    ratePerMinute += species.baseCrystalRate * levelMultiplier(droid.level) * slot.multiplier * variantMultiplier;
  }
  ratePerMinute *= companionBuffMultiplier(playerId);
  ratePerMinute *= OFFLINE_RATE_MULTIPLIER;

  const hourlyRate = Math.floor(ratePerMinute * 60);
  const maxTotal = Math.floor(ratePerMinute * 60 * MAX_OFFLINE_HOURS);
  return { hourlyRate, maxOfflineHours: MAX_OFFLINE_HOURS, maxTotal, offlineRatePercent: Math.round(OFFLINE_RATE_MULTIPLIER * 100) };
}

function calculateEarnings(playerId, now = Date.now()) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');

  // NOTE: the game has no true "player is actively looking at the app
  // right now" signal — only "time since we last settled their
  // earnings." So this multiplier applies to the whole elapsed gap,
  // not just genuinely-offline time. In practice this barely matters
  // for someone actively playing (gaps between settles stay short),
  // but it's worth being explicit that this isn't a precise
  // foreground/background distinction.
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
  earned *= OFFLINE_RATE_MULTIPLIER;

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
  if (enrichDroid(droid).fainted) throw new Error('This droid is fainted — heal it with a Repair Kit first');
  if (droid.level >= db.DROID_LEVEL_CAP) throw new Error(`Droid is already at the level cap (${db.DROID_LEVEL_CAP})`);

  const species = speciesById(droid.speciesId);

  // Apex droids level on Apex Cubes, not crystals — an entirely separate
  // currency, so a huge crystal balance can't fast-track the endgame set.
  // Same endpoint and same level cap; only the cost source differs.
  if (db.isApexSpecies(species)) {
    const cubeCost = db.apexCubeLevelUpCost(droid.level);
    const held = player.apexCubes || 0;
    if (held < cubeCost) {
      throw new Error(`Not enough Apex Cubes — leveling this Apex costs ${cubeCost} (you have ${held})`);
    }
    player.apexCubes = held - cubeCost;
    droid.level += 1;
    return {
      droid: enrichDroid(droid),
      cost: cubeCost,
      costCurrency: 'apexCubes',
      apexCubes: player.apexCubes,
      crystalBalance: player.crystalBalance,
      settledEarned: settled.earned,
    };
  }

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

  return { droid: enrichDroid(droid), cost, costCurrency: 'crystals', crystalBalance: player.crystalBalance, settledEarned: settled.earned };
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
const CHAIN_MATERIAL_DROP_CHANCE = 0.03; // matches capture.js — rarer than Nova Chip drop, only Zombie/Lumen line droids

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

// One-time retroactive sweep — auto-release-duplicates only prevents
// NEW duplicates from accumulating going forward; it was never meant
// to reach back into the Warehouse and clean up what's already there.
// This button does that specific, separate job, using the exact same
// eligibility rules as the at-capture-time version (common/uncommon
// only, standard always eligible, rusty/platinum only if the second
// toggle is on, Funky and Scaffitan never eligible) — keeping the
// oldest droid of each duplicate group and releasing the rest.
function cleanupExistingDuplicates(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  const includeVariants = !!player.autoReleaseIncludeVariants;

  const myDroids = [...db.ownedDroids.values()]
    .filter((d) => d.playerId === playerId && !d.workshopSlotId) // don't touch anything currently farming
    .map((d) => ({ droid: d, species: db.droidSpecies.find((s) => s.id === d.speciesId) }))
    .filter(({ species, droid }) => {
      if (!species || species.collection === 'titan') return false; // Scaffitan never eligible
      if (!['common', 'uncommon'].includes(species.rarity)) return false;
      if (droid.variant === 'standard') return true;
      if (includeVariants && ['rusty', 'platinum'].includes(droid.variant)) return true;
      return false; // Funky, or variants when the second toggle is off
    });

  const groups = {};
  myDroids.forEach(({ droid, species }) => {
    const key = species.id + ':' + droid.variant;
    if (!groups[key]) groups[key] = [];
    groups[key].push(droid);
  });

  let releasedCount = 0;
  let totalRefund = 0;
  Object.values(groups).forEach((group) => {
    if (group.length < 2) return;
    group.sort((a, b) => a.capturedAt - b.capturedAt); // keep the oldest
    group.slice(1).forEach((droid) => {
      const refund = Math.floor((droid.captureCost || 0) * db.RELEASE_REFUND_MULTIPLIER);
      player.crystalBalance += refund;
      if (refund > 0) {
        db.crystalTransactions.push({ id: db.nextId(), playerId, amount: refund, source: 'duplicate_cleanup', createdAt: Date.now() });
      }
      if (player.companionDroidId === droid.id) player.companionDroidId = null;
      db.ownedDroids.delete(droid.id);
      releasedCount += 1;
      totalRefund += refund;
    });
  });

  return { releasedCount, totalRefund, crystalBalance: player.crystalBalance };
}

function releaseDroid(playerId, droidId) {
  const settled = settleEarnings(playerId);
  const player = db.players.get(playerId);
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  if (enrichDroid(droid).fainted) throw new Error('This droid is fainted — heal it with a Repair Kit first');
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

  let gotChainMaterial = null;
  let apexCubesDropped = 0;
  if (db.isApexSpecies(species)) {
    // Releasing an Apex always returns cubes — the third confirmed drop
    // route alongside capturing and defeating one.
    apexCubesDropped = db.rollApexCubeDrop();
    player.apexCubes = (player.apexCubes || 0) + apexCubesDropped;
  }
  if (species && species.collection === 'void_zombie' && Math.random() < CHAIN_MATERIAL_DROP_CHANCE) {
    player.zombieJuice = (player.zombieJuice || 0) + 1;
    gotChainMaterial = 'zombieJuice';
  } else if (species && species.collection === 'lumen_sentinel' && Math.random() < CHAIN_MATERIAL_DROP_CHANCE) {
    player.lumeCells = (player.lumeCells || 0) + 1;
    gotChainMaterial = 'lumeCells';
  }

  if (player.companionDroidId === droidId) player.companionDroidId = null;
  db.ownedDroids.delete(droidId);

  return { refund, gotNovaChip, gotChainMaterial, apexCubesDropped, apexCubes: player.apexCubes || 0, novaChips: player.novaChips, crystalBalance: player.crystalBalance, settledEarned: settled.earned };
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
function toggleHiddenFromTrade(playerId, droidId) {
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
  droid.hiddenFromTrade = !droid.hiddenFromTrade;
  return { droid: enrichDroid(droid) };
}

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
  (evolution.extraMaterials || []).forEach(({ key, cost }) => {
    const owned = player[key] || 0;
    if (owned < cost) throw new Error(`Not enough ${key} — this evolution needs ${cost}`);
  });

  // All validated — now actually deduct everything.
  player.novaChips -= evolution.novaChipCost;
  if (evolution.extraCrystalCost) {
    player.crystalBalance -= evolution.extraCrystalCost;
    db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -evolution.extraCrystalCost, source: 'species_evolution', createdAt: Date.now() });
  }
  (evolution.extraMaterials || []).forEach(({ key, cost }) => {
    player[key] -= cost;
  });
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

function equipCosmetic(playerId, slot, cosmeticId) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!['head', 'body', 'arms', 'legs'].includes(slot)) throw new Error('Invalid cosmetic slot');
  const item = db.COSMETICS_CATALOG.find((c) => c.id === cosmeticId);
  if (!item) throw new Error('Unknown cosmetic');
  if (item.slot !== slot) throw new Error(`This cosmetic goes in the ${item.slot} slot, not ${slot}`);
  if (!player.cosmetics.includes(cosmeticId)) throw new Error('You don\'t own this cosmetic');
  if (!player.equippedCosmetics) player.equippedCosmetics = { head: null, body: null, arms: null, legs: null };
  player.equippedCosmetics[slot] = cosmeticId;
  return { equippedCosmetics: player.equippedCosmetics };
}

function unequipCosmetic(playerId, slot) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (!['head', 'body', 'arms', 'legs'].includes(slot)) throw new Error('Invalid cosmetic slot');
  if (!player.equippedCosmetics) player.equippedCosmetics = { head: null, body: null, arms: null, legs: null };
  player.equippedCosmetics[slot] = null;
  return { equippedCosmetics: player.equippedCosmetics };
}

module.exports = {
  calculateEarnings,
  calculateOfflineProjection,
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
  getPlayerBuffsSummary,
  releaseDroid,
  cleanupExistingDuplicates,
  releaseDroidsBulk,
  evolveSpecies,
  healDroid,
  masterScaffitan,
  toggleHiddenFromTrade,
  evolveFunky,
  assignCompanion,
  unassignCompanion,
  buyCosmetic,
  equipCosmetic,
  unequipCosmetic,
  MAX_OFFLINE_HOURS,
};
