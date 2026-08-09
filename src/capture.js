// capture.js
//
// The client NEVER decides capture success. It submits raw inputs
// (crystalsSpent, padAccuracy, timing, location) and this module is the
// sole source of truth for the outcome.

const db = require('./db');
const geo = require('./geo');
const workshop = require('./workshop');

// ---- CAPTURE RADIUS — the one number to change ----
// A droid can only be taken into the minigame when the player is within
// this many meters of it. Droids further out than this still appear on
// the map (see spawns.js `withinCaptureRadius`), but the client hides
// their capture controls and the server rejects any attempt anyway —
// this check is the authoritative one, the client greying-out is only a
// convenience so players aren't offered a button that can't work.
//
// Raise or lower this single value to widen/tighten the capture zone.
// The wider "how far can I see" number is separate: DEFAULT_SCAN_RADIUS
// in test-terminal.html.
const CAPTURE_RADIUS_METERS = 15;

const MAX_PLAUSIBLE_RANGE_METERS = CAPTURE_RADIUS_METERS; // kept as an alias so existing references still read naturally
const CAPTURE_ATTEMPT_COOLDOWN_MS = 3000; // 3 seconds — stops spam-clicking captures
const MIN_PLAUSIBLE_ATTEMPT_MS = 250; // faster than this + high accuracy = bot signature
const CRYSTAL_BONUS_CAP = 0.40; // spending max crystals gives up to +40% chance
const CRYSTAL_COST_TO_MAX = 30; // crystals spent at which bonus caps out
const PAINT_DROP_CHANCE = 0.05; // 5% chance any successful capture also drops 1 Paint
const CHAIN_MATERIAL_DROP_CHANCE = 0.03; // rarer than Paint — only from capturing/releasing Shambler or Illume specifically

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

  const now = Date.now();
  if (player.lastCaptureAttemptAt && now - player.lastCaptureAttemptAt < CAPTURE_ATTEMPT_COOLDOWN_MS) {
    throw new CaptureError('TOO_FAST', 'Slow down a moment before your next attempt');
  }

  const spawn = db.spawns.get(spawnId);
  if (!spawn) throw new CaptureError('SPAWN_NOT_FOUND', 'Spawn no longer exists');
  if (spawn.claimedBy) {
    throw new CaptureError('ALREADY_CLAIMED', spawn.fledFrom ? 'You already ran from this one — it\'s gone for good' : 'Spawn already captured');
  }
  if (spawn.expiresAt <= Date.now()) throw new CaptureError('SPAWN_EXPIRED', 'Spawn expired');

  // --- anti-cheat validation ---
  const dist = geo.distanceMeters(playerLat, playerLng, spawn.lat, spawn.lng);
  if (dist > MAX_PLAUSIBLE_RANGE_METERS) {
    throw new CaptureError('OUT_OF_RANGE', `Too far away — you're ${Math.round(dist)}m from this droid, and you need to be within ${CAPTURE_RADIUS_METERS}m to capture it`);
  }

  if (padAccuracy > 0.97 && attemptDurationMs < MIN_PLAUSIBLE_ATTEMPT_MS) {
    throw new CaptureError('SUSPICIOUS_INPUT', 'Attempt rejected: implausible accuracy/timing combo');
  }

  if (crystalsSpent < 0 || crystalsSpent > player.crystalBalance) {
    throw new CaptureError('INSUFFICIENT_CRYSTALS', 'Not enough crystals');
  }

  const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
  // Minimum cost scales with Pad Level — a deliberate crystal sink so
  // upgrading the pad doesn't just let crystals pile up unused.
  const minCost = db.scaledMinCrystalCost(species.rarity, player.padLevel);
  if (crystalsSpent < minCost) {
    throw new CaptureError(
      'NO_CRYSTAL_POWER',
      `The control pad needs at least ${minCost} crystals to attempt a ${species.rarity} droid`
    );
  }

  // Only counts as a real "attempt" for cooldown purposes once it's past
  // every validation check above — nothing was actually spent or risked
  // by a request that fails here, so it shouldn't cost the player a
  // 3-second lockout for a typo or an out-of-range tap.
  player.lastCaptureAttemptAt = now;

  let successChance =
    species.baseCaptureRate * crystalBonus(crystalsSpent) * padSkillMultiplier(padAccuracy, player.padLevel);
  const companionMultiplier = workshop.companionCaptureRateMultiplier(playerId); // Nebulfox: +100% success chance, helps with tough Legendary attempts
  successChance *= companionMultiplier;
  successChance = Math.max(0.05, Math.min(0.95, successChance)); // clamp 5%-95%
  const buffsApplied = [];
  if (companionMultiplier > 1) buffsApplied.push({ name: 'Nebulfox', effect: `+${Math.round((companionMultiplier - 1) * 100)}% capture chance` });

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
  let gotChainMaterial = null;
  let autoReleased = false;
  let autoReleaseRefund = 0;

  // --- Apex Cubes ---
  // Awarded for ANY resolved attempt on an Apex droid, win or lose. With
  // a 2% base capture rate, paying out only on success would mean a
  // player could burn an entire 30-minute Apex Hunt and end with nothing
  // at all — so the encounter itself is what pays, not the catch.
  let apexCubesDropped = 0;
  if (db.isApexSpecies(species)) {
    apexCubesDropped = db.rollApexCubeDrop();
    player.apexCubes = (player.apexCubes || 0) + apexCubesDropped;
  }

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
      currentHpDamage: 0, // damage taken in battle, persists until healed — null/0 means full HP
      hiddenFromTrade: false,
    };
    db.ownedDroids.set(newDroid.id, newDroid);
    db.markDexSeen(playerId, species.id, spawn.variant);

    gotPaint = Math.random() < PAINT_DROP_CHANCE;
    if (gotPaint) player.paint += 1;

    if (species.name === 'Shambler' && Math.random() < CHAIN_MATERIAL_DROP_CHANCE) {
      player.zombieJuice = (player.zombieJuice || 0) + 1;
      gotChainMaterial = 'zombieJuice';
    } else if (species.name === 'Illume' && Math.random() < CHAIN_MATERIAL_DROP_CHANCE) {
      player.lumeCells = (player.lumeCells || 0) + 1;
      gotChainMaterial = 'lumeCells';
    }

    // Auto-release-duplicates — opt-in, off by default. Base behavior:
    // a newly-captured STANDARD-variant Common/Uncommon droid where the
    // player already owns that species elsewhere in storage.
    // Second toggle (autoReleaseIncludeVariants) extends this to
    // Rusty/Platinum too — but variant-matched: a new Rusty only
    // auto-releases if a Rusty of that species is already owned, never
    // just because a standard one exists. Funky is never included,
    // regardless of this toggle — too easy to lose a paint job by accident.
    const includeVariants = player.autoReleaseIncludeVariants && ['rusty', 'platinum'].includes(spawn.variant);
    const isEligibleForAutoRelease = spawn.variant === 'standard' || includeVariants;
    if (
      player.autoReleaseDuplicates &&
      isEligibleForAutoRelease &&
      ['common', 'uncommon'].includes(species.rarity)
    ) {
      const alreadyOwnsMatch = [...db.ownedDroids.values()].some(
        (d) => d.playerId === playerId && d.speciesId === species.id && d.variant === spawn.variant && d.id !== newDroid.id
      );
      if (alreadyOwnsMatch) {
        autoReleaseRefund = Math.floor(newDroid.captureCost * db.RELEASE_REFUND_MULTIPLIER);
        player.crystalBalance += autoReleaseRefund;
        if (autoReleaseRefund > 0) {
          db.crystalTransactions.push({ id: db.nextId(), playerId, amount: autoReleaseRefund, source: 'auto_release_duplicate', createdAt: Date.now() });
        }
        db.ownedDroids.delete(newDroid.id);
        autoReleased = true;
      }
    }
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
    gotChainMaterial,
    paint: player.paint,
    spawnExpiresAt: spawn.expiresAt,
    autoReleased,
    autoReleaseRefund,
    buffsApplied,
    isApex: db.isApexSpecies(species),
    apexCubesDropped,
    apexCubes: player.apexCubes || 0,
  };
}

module.exports = { resolveCaptureAttempt, CaptureError, crystalBonus, padSkillMultiplier, CAPTURE_RADIUS_METERS };
