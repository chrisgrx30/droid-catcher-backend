// factory.js
//
// Factory/Prototype system: win an egg from a minigame (cooldown-gated),
// assign it to a purchased Processor slot and pay to start a 20h
// incubation, then collect — rolling a fixed rarity table independent of
// minigame skill. See db.js for the underlying data (PROCESSOR_SLOT_*,
// FACTORY_*, PROTOTYPE_RARITY_TABLE) and constants.

const db = require('./db');
const levels = require('./levels');
const ach = require('./achievements');

class FactoryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function unlockProcessorSlot(playerId, slotId) {
  const player = db.players.get(playerId);
  const slot = db.processorSlots.get(slotId);
  if (!player) throw new FactoryError('NOT_FOUND', 'Player not found');
  if (!slot || slot.playerId !== playerId) throw new FactoryError('NOT_FOUND', 'Slot not found for player');
  if (slot.unlocked) throw new FactoryError('ALREADY_UNLOCKED', 'Slot is already unlocked');

  const cost = db.PROCESSOR_SLOT_COSTS[slot.slotIndex];
  if (player.crystalBalance < cost) throw new FactoryError('INSUFFICIENT_CRYSTALS', `Not enough crystals — this slot costs ${cost}`);

  player.crystalBalance -= cost;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -cost, source: 'processor_slot_unlock', createdAt: Date.now() });
  slot.unlocked = true;
  return { slot, cost, crystalBalance: player.crystalBalance };
}

// The Factory minigame itself — same "server is the sole source of
// truth" pattern as capture.js: the client submits raw timing/placement
// data (hit + closeness), never decides the outcome on its own. Unlike
// capture, accuracy here only gates hit-vs-miss, not reward quality — a
// hit's actual prize is decided later, entirely by the rarity table.
const MIN_PLAUSIBLE_ATTEMPT_MS = 200; // same anti-bot floor pattern as capture.js

function attemptFactoryMinigame(playerId, hit, attemptDurationMs) {
  const player = db.players.get(playerId);
  if (!player) throw new FactoryError('NOT_FOUND', 'Player not found');

  const now = Date.now();
  if (player.factoryCooldownUntil && now < player.factoryCooldownUntil) {
    const minsLeft = Math.ceil((player.factoryCooldownUntil - now) / 60000);
    throw new FactoryError('COOLDOWN', `Factory is on cooldown for another ~${minsLeft}m`);
  }
  if (attemptDurationMs < MIN_PLAUSIBLE_ATTEMPT_MS) {
    throw new FactoryError('SUSPICIOUS_INPUT', 'Attempt rejected: implausible timing');
  }
  if (player.crystalBalance < db.FACTORY_MINIGAME_COST) {
    throw new FactoryError('INSUFFICIENT_CRYSTALS', `Not enough crystals — attempting costs ${db.FACTORY_MINIGAME_COST}`);
  }

  player.crystalBalance -= db.FACTORY_MINIGAME_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -db.FACTORY_MINIGAME_COST, source: 'factory_attempt', createdAt: now });

  let egg = null;
  if (hit) {
    egg = { id: db.nextId(), playerId, createdAt: now };
    db.eggs.set(egg.id, egg);
    player.factoryCooldownUntil = now + db.FACTORY_COOLDOWN_MS; // only a successful attempt starts the cooldown — a miss can be retried immediately
  }

  return { hit, egg, crystalBalance: player.crystalBalance, factoryCooldownUntil: player.factoryCooldownUntil };
}

// Assign an unassigned egg to an empty, unlocked Processor slot and pay
// to start its 20h incubation. Separate cost from the minigame attempt
// that won the egg in the first place.
function assignEggToProcessor(playerId, eggId, slotId) {
  const player = db.players.get(playerId);
  const egg = db.eggs.get(eggId);
  const slot = db.processorSlots.get(slotId);
  if (!player) throw new FactoryError('NOT_FOUND', 'Player not found');
  if (!egg || egg.playerId !== playerId) throw new FactoryError('NOT_FOUND', 'Egg not found for player');
  if (!slot || slot.playerId !== playerId) throw new FactoryError('NOT_FOUND', 'Slot not found for player');
  if (!slot.unlocked) throw new FactoryError('LOCKED', 'This Processor slot is locked — unlock it first');
  if (slot.eggId) throw new FactoryError('OCCUPIED', 'This slot is already incubating an egg');
  if (player.crystalBalance < db.FACTORY_START_HATCH_COST) {
    throw new FactoryError('INSUFFICIENT_CRYSTALS', `Not enough crystals — starting incubation costs ${db.FACTORY_START_HATCH_COST}`);
  }

  player.crystalBalance -= db.FACTORY_START_HATCH_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -db.FACTORY_START_HATCH_COST, source: 'factory_start_hatch', createdAt: Date.now() });

  const hatchReadyAt = Date.now() + db.FACTORY_HATCH_DURATION_MS;
  slot.eggId = eggId;
  slot.hatchReadyAt = hatchReadyAt;
  db.eggs.delete(eggId); // now "inside" the slot rather than sitting unassigned

  return { slot, hatchReadyAt, crystalBalance: player.crystalBalance };
}

// Collect a finished incubation — rolls the fixed rarity table, grants a
// droid, frees the slot for reuse immediately (no extra per-slot cooldown).
function collectPrototype(playerId, slotId) {
  const player = db.players.get(playerId);
  const slot = db.processorSlots.get(slotId);
  if (!player) throw new FactoryError('NOT_FOUND', 'Player not found');
  if (!slot || slot.playerId !== playerId) throw new FactoryError('NOT_FOUND', 'Slot not found for player');
  if (!slot.eggId) throw new FactoryError('EMPTY', 'This slot has nothing incubating');
  if (Date.now() < slot.hatchReadyAt) {
    const minsLeft = Math.ceil((slot.hatchReadyAt - Date.now()) / 60000);
    throw new FactoryError('NOT_READY', `Still incubating — ready in ~${minsLeft}m`);
  }

  levels.awardXp(playerId, 'hatch');
  require('./ladder').award(playerId, 'hatch');
  require('./seasonpass').awardXp(playerId, 'hatch');
  ach.track(playerId, 'eggsHatched');

  const rarity = db.rollPrototypeRarity();
  const candidates = db.eligiblePrototypeSpecies(rarity);
  const species = candidates[Math.floor(Math.random() * candidates.length)];

  const droid = {
    id: db.nextId(),
    playerId,
    speciesId: species.id,
    variant: 'standard',
    level: 1,
    captureCost: 0, // hatched, not captured — releasing it later refunds nothing, same as a starter droid
    capturedAt: Date.now(),
    workshopSlotId: null,
  };
  db.ownedDroids.set(droid.id, droid);
  db.markDexSeen(playerId, species.id, 'standard');

  slot.eggId = null;
  slot.hatchReadyAt = null;

  return { droid: { id: droid.id, speciesName: species.name, rarity: species.rarity } };
}

// Crush an unhatched egg — either sitting unassigned, or mid-incubation
// (forfeiting the wait and the crystals already spent starting it) — for
// a small chance of a Nova Chip. Deliberately worse odds than releasing
// an actual captured droid, since this is destroying unrealized
// potential, not something you caught.
function crushEgg(playerId, eggId) {
  const player = db.players.get(playerId);
  const egg = db.eggs.get(eggId);
  if (!player) throw new FactoryError('NOT_FOUND', 'Player not found');
  if (!egg || egg.playerId !== playerId) throw new FactoryError('NOT_FOUND', 'Egg not found for player');

  db.eggs.delete(eggId);
  const gotNovaChip = Math.random() < db.CRUSH_NOVA_CHIP_CHANCE;
  if (gotNovaChip) player.novaChips += 1;
  return { gotNovaChip, novaChips: player.novaChips };
}

function crushIncubatingEgg(playerId, slotId) {
  const player = db.players.get(playerId);
  const slot = db.processorSlots.get(slotId);
  if (!player) throw new FactoryError('NOT_FOUND', 'Player not found');
  if (!slot || slot.playerId !== playerId) throw new FactoryError('NOT_FOUND', 'Slot not found for player');
  if (!slot.eggId) throw new FactoryError('EMPTY', 'This slot has nothing incubating');

  slot.eggId = null;
  slot.hatchReadyAt = null;
  const gotNovaChip = Math.random() < db.CRUSH_NOVA_CHIP_CHANCE;
  if (gotNovaChip) player.novaChips += 1;
  return { gotNovaChip, novaChips: player.novaChips };
}

module.exports = {
  FactoryError,
  unlockProcessorSlot,
  attemptFactoryMinigame,
  assignEggToProcessor,
  collectPrototype,
  crushEgg,
  crushIncubatingEgg,
};
