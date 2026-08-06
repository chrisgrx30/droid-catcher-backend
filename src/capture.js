// capture.js
//
// The client NEVER decides capture success. It submits raw inputs
// (crystalsSpent, padAccuracy, timing, location) and this module is the
// sole source of truth for the outcome.

const db = require('./db');
const geo = require('./geo');
const workshop = require('./workshop');

const MAX_PLAUSIBLE_RANGE_METERS = 75; // player must be roughly at the spawn
const MIN_PLAUSIBLE_ATTEMPT_MS = 250; // faster than this + high accuracy = bot signature
const CRYSTAL_BONUS_CAP = 0.40; // spending max crystals gives up to +40% chance
const CRYSTAL_COST_TO_MAX = 30; // crystals spent at which bonus caps out
const PAINT_DROP_CHANCE = 0.05; // 5% chance any successful capture also drops 1 Paint

function crystalBonus(crystalsSpent) {
  const ratio = Math.min(crystalsSpent / CRYSTAL_COST_TO_MAX, 1);
  return 1 + ratio * CRYSTAL_BONUS_CAP;
}

function padSkillMultiplier(padAccuracy, padLevel = 0) {
  // padAccuracy in [0,1] -> multiplier in [0.8, ceiling]. Ceiling nudges up
  // slightly with pad level so upgrading the pad rewards skilled play too,
  // not just the flat crit chance.
  const clamped = Math.max(0, Math.min(1, padAccuracy));
  const ceiling = 1.2 + db.PAD_SKILL_CEILING_PER_LEVEL * padLevel;
  const range = ceiling - 0.8;
  return 0.8 + clamped * range;
}

class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function resolveCaptureAttempt({ playerId, spawnId, crystalsSpent, padAccuracy, attemptDurationMs, playerLat, playerLng }) {
  const player = db.players.get(playerId);
  if (!player) throw new CaptureError('NO_PLAYER', 'Player not found');

  const spawn = db.spawns.get(spawnId);
  if (!spawn) throw new CaptureError('SPAWN_NOT_FOUND', 'Spawn no longer exists');
  if (spawn.claimedBy) throw new CaptureError('ALREADY_CLAIMED', 'Spawn already captured');
  if (spawn.expiresAt <= Date.now()) throw new CaptureError('SPAWN_EXPIRED', 'Spawn expired');

  // --- anti-cheat validation ---
  const dist = geo.distanceMeters(playerLat, playerLng, spawn.lat, spawn.lng);
  if (dist > MAX_PLAUSIBLE_RANGE_METERS) {
    throw new CaptureError('OUT_OF_RANGE', `Player too far from spawn (${Math.round(dist)}m)`);
  }

  if (padAccuracy > 0.97 && attemptDurationMs < MIN_PLAUSIBLE_ATTEMPT_MS) {
    throw new CaptureError('SUSPICIOUS_INPUT', 'Attempt rejected: implausible accuracy/timing combo');
  }

  if (crystalsSpent < 0 || crystalsSpent > player.crystalBalance) {
    throw new CaptureError('INSUFFICIENT_CRYSTALS', 'Not enough crystals');
  }

  const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
  const minCost = db.MIN_CRYSTAL_COST[species.rarity];
  if (crystalsSpent < minCost) {
    throw new CaptureError(
      'NO_CRYSTAL_POWER',
      `The control pad needs at least ${minCost} crystals to attempt a ${species.rarity} droid`
    );
  }
  let successChance =
    species.baseCaptureRate * crystalBonus(crystalsSpent) * padSkillMultiplier(padAccuracy, player.padLevel);
  successChance *= workshop.companionCaptureRateMultiplier(playerId); // Nebulfox: +100% success chance, helps with tough Legendary attempts
  successChance = Math.max(0.05, Math.min(0.95, successChance)); // clamp 5%-95%

  // --- critical capture: pad-level-based chance of a guaranteed success ---
  const critChance = db.critChanceForPadLevel(player.padLevel || 0);
  const isCritical = Math.random() < critChance;
  const success = isCritical ? true : Math.random() < successChance;

  // --- deduct crystals regardless of outcome (spent = spent, win or lose) ---
  if (crystalsSpent > 0) {
    player.crystalBalance -= crystalsSpent;
    db.crystalTransactions.push({
      id: db.nextId(),
      playerId,
      amount: -crystalsSpent,
      source: 'capture_attempt',
      createdAt: Date.now(),
    });
  }

  let newDroid = null;
  let gotPaint = false;

  if (success) {
    spawn.claimedBy = playerId;
    newDroid = {
      id: db.nextId(),
      playerId,
      speciesId: species.id,
      variant: spawn.variant,
      level: 1,
      captureCost: crystalsSpent, // remembered for the 1.5x refund if released later
      capturedAt: Date.now(),
      workshopSlotId: null,
    };
    db.ownedDroids.set(newDroid.id, newDroid);
    db.markDexSeen(playerId, species.id, spawn.variant);

    gotPaint = Math.random() < PAINT_DROP_CHANCE;
    if (gotPaint) player.paint += 1;
  } else {
    // failed attempt shortens remaining TTL, per design (no infinite spam-tapping)
    const remaining = spawn.expiresAt - Date.now();
    spawn.expiresAt = Date.now() + Math.max(remaining * 0.5, 0);
  }

  const attemptRecord = {
    id: db.nextId(),
    playerId,
    spawnId,
    crystalsSpent,
    padAccuracy,
    successChance,
    critical: isCritical,
    result: success,
    attemptedAt: Date.now(),
  };
  db.captureAttempts.push(attemptRecord);

  return {
    success,
    successChance,
    critical: isCritical,
    crystalBalance: player.crystalBalance,
    droid: newDroid ? { id: newDroid.id, speciesName: species.name, rarity: species.rarity, variant: newDroid.variant, isCompanion: species.isCompanion || false } : null,
    gotPaint,
    paint: player.paint,
    spawnExpiresAt: spawn.expiresAt,
  };
}

module.exports = { resolveCaptureAttempt, CaptureError };
