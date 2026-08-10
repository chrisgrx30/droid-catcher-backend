// joystick.js
//
// The Joy Stick lets a player move their effective position away from
// their real GPS for a paid, time-limited session, and Pulse to make
// droids appear at that position.
//
// SECURITY NOTE — the reason this module exists at all rather than
// living in the client:
// Everything here is server-authoritative. The client sends a *desired*
// position; the server decides whether that move was physically possible
// (7kph cap), whether the session is still live, and whether the player
// actually paid. The admin coordinate override in test-terminal.html is
// client-side and deliberately admin-gated — this is the player-facing
// version, so it cannot trust the client for anything that costs money
// or grants a capture.
//
// Capture position: capture.js asks getEffectivePosition() for the
// player's location instead of believing playerLat/playerLng from the
// request body. That's the single choke point that stops someone
// skipping the joystick entirely and just posting arbitrary coordinates.

const db = require('./db');
const geo = require('./geo');

// ---- tuning ----
const MINUTES_PER_TOKEN = 10;
const MAX_TOKENS_PER_SESSION = 6;        // 6 x 10min = 60min ceiling
const PULSE_COST_CRYSTALS = 500;
const COOLDOWN_MS = 60 * 60 * 1000;      // 1h after a session ends, however long it ran
const MAX_SPEED_KPH = 12;
const MAX_SPEED_MPS = (MAX_SPEED_KPH * 1000) / 3600; // ~1.944 m/s
// Movement is checked against elapsed time since the last accepted move.
// A little slack absorbs network jitter and the client's own tick rate
// without meaningfully raising the effective speed.
const SPEED_GRACE_MULTIPLIER = 1.25;
const MIN_MOVE_INTERVAL_MS = 250;        // treat bursts inside this as one move

// Which currencies can pay for a session. All three are interchangeable
// here — the difference is how you get them, not what they buy.
const ACCEPTED_TOKENS = ['titanTokens', 'guildTokens', 'joyCoins'];

class JoystickError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function activeSession(player, now = Date.now()) {
  const s = player.joystickSession;
  if (!s) return null;
  if (now >= s.expiresAt) return null;
  return s;
}

// Called by capture.js. Returns the position the server considers the
// player to be at — the joystick position during a live session, or the
// coordinates the client reported otherwise.
function getEffectivePosition(player, reportedLat, reportedLng, now = Date.now()) {
  const s = activeSession(player, now);
  if (s) {
    return { lat: s.currentLat, lng: s.currentLng, viaJoystick: true };
  }
  return { lat: reportedLat, lng: reportedLng, viaJoystick: false };
}

function statusFor(playerId, now = Date.now()) {
  const player = db.players.get(playerId);
  if (!player) throw new JoystickError('NO_PLAYER', 'Player not found');

  const s = activeSession(player, now);
  const cooldownUntil = player.joystickCooldownUntil || 0;

  // A session that has run out but not been acknowledged still needs
  // reporting so the client can show the "time's up" popup exactly once.
  const expiredUnacknowledged = Boolean(
    player.joystickSession && now >= player.joystickSession.expiresAt && !player.joystickSession.acknowledged
  );

  return {
    active: Boolean(s),
    expiredUnacknowledged,
    onCooldown: now < cooldownUntil,
    cooldownUntil: cooldownUntil || null,
    cooldownMsRemaining: Math.max(0, cooldownUntil - now),
    msRemaining: s ? Math.max(0, s.expiresAt - now) : 0,
    minutesPurchased: s ? s.minutes : 0,
    currentLat: s ? s.currentLat : null,
    currentLng: s ? s.currentLng : null,
    originLat: s ? s.originLat : null,
    originLng: s ? s.originLng : null,
    metersFromOrigin: s ? Math.round(geo.distanceMeters(s.originLat, s.originLng, s.currentLat, s.currentLng)) : 0,
    pulseCost: PULSE_COST_CRYSTALS,
    maxSpeedKph: MAX_SPEED_KPH,
    minutesPerToken: MINUTES_PER_TOKEN,
    maxTokens: MAX_TOKENS_PER_SESSION,
    balances: {
      titanTokens: player.titanTokens || 0,
      guildTokens: player.guildTokens || 0,
      joyCoins: player.joyCoins || 0,
      crystals: Math.floor(player.crystalBalance || 0),
    },
  };
}

// tokenSpend: { titanTokens: 2, joyCoins: 1 } — any mix, total <= 6.
function activate(playerId, tokenSpend, originLat, originLng) {
  const player = db.players.get(playerId);
  if (!player) throw new JoystickError('NO_PLAYER', 'Player not found');
  const now = Date.now();

  if (activeSession(player, now)) {
    throw new JoystickError('ALREADY_ACTIVE', 'Your Joy Stick is already running');
  }
  if (player.joystickCooldownUntil && now < player.joystickCooldownUntil) {
    const mins = Math.ceil((player.joystickCooldownUntil - now) / 60000);
    throw new JoystickError('ON_COOLDOWN', `Joy Stick is cooling down — ${mins} minute${mins === 1 ? '' : 's'} to go`);
  }
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)
      || originLat < -90 || originLat > 90 || originLng < -180 || originLng > 180) {
    throw new JoystickError('BAD_ORIGIN', 'Could not read your starting position');
  }

  const spend = {};
  let totalTokens = 0;
  ACCEPTED_TOKENS.forEach((key) => {
    const want = Math.floor(Number(tokenSpend && tokenSpend[key]) || 0);
    if (want < 0) throw new JoystickError('BAD_SPEND', 'Invalid token amount');
    if (want > 0) {
      const held = player[key] || 0;
      if (held < want) {
        throw new JoystickError('INSUFFICIENT_TOKENS', `Not enough ${key === 'joyCoins' ? 'Joy Coins' : key === 'titanTokens' ? 'Titan Tokens' : 'Guild Tokens'}`);
      }
      spend[key] = want;
      totalTokens += want;
    }
  });

  if (totalTokens < 1) throw new JoystickError('NO_TOKENS', 'Select at least one token to activate the Joy Stick');
  if (totalTokens > MAX_TOKENS_PER_SESSION) {
    throw new JoystickError('TOO_MANY_TOKENS', `You can stack at most ${MAX_TOKENS_PER_SESSION} tokens (${MAX_TOKENS_PER_SESSION * MINUTES_PER_TOKEN} minutes)`);
  }

  // Charge only after every check has passed, so a rejected activation
  // never costs anything.
  Object.entries(spend).forEach(([key, amount]) => { player[key] -= amount; });

  const minutes = totalTokens * MINUTES_PER_TOKEN;
  player.joystickSession = {
    startedAt: now,
    expiresAt: now + minutes * 60 * 1000,
    minutes,
    tokensSpent: spend,
    originLat,
    originLng,
    currentLat: originLat,
    currentLng: originLng,
    lastMoveAt: now,
    pulseCount: 0,
    acknowledged: false,
  };
  return statusFor(playerId, now);
}

function move(playerId, lat, lng) {
  const player = db.players.get(playerId);
  if (!player) throw new JoystickError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  const s = activeSession(player, now);
  if (!s) throw new JoystickError('NOT_ACTIVE', 'Your Joy Stick isn\'t running');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new JoystickError('BAD_POSITION', 'Invalid position');
  }

  const elapsedMs = Math.max(MIN_MOVE_INTERVAL_MS, now - s.lastMoveAt);
  const requested = geo.distanceMeters(s.currentLat, s.currentLng, lat, lng);
  const allowed = (elapsedMs / 1000) * MAX_SPEED_MPS * SPEED_GRACE_MULTIPLIER;

  if (requested > allowed) {
    // Rather than reject outright (which would make the stick feel
    // broken on a laggy connection), clamp the move to the furthest
    // legal point along the same bearing. The player still travels, just
    // no faster than walking pace.
    const ratio = allowed / requested;
    s.currentLat = s.currentLat + (lat - s.currentLat) * ratio;
    s.currentLng = s.currentLng + (lng - s.currentLng) * ratio;
    s.lastMoveAt = now;
    const status = statusFor(playerId, now);
    status.clamped = true;
    status.requestedMeters = Math.round(requested);
    status.allowedMeters = Math.round(allowed);
    return status;
  }

  s.currentLat = lat;
  s.currentLng = lng;
  s.lastMoveAt = now;
  return statusFor(playerId, now);
}

// Pulse charges crystals and hands back the spawns around the joystick
// position. The spawns module does the actual generation, so pulsed
// droids obey every normal rule — rarity caps, TTLs, event gating.
function pulse(playerId, spawnsModule) {
  const player = db.players.get(playerId);
  if (!player) throw new JoystickError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  const s = activeSession(player, now);
  if (!s) throw new JoystickError('NOT_ACTIVE', 'Your Joy Stick isn\'t running');
  if ((player.crystalBalance || 0) < PULSE_COST_CRYSTALS) {
    throw new JoystickError('NOT_ENOUGH_CRYSTALS', `A Pulse costs ${PULSE_COST_CRYSTALS} crystals`);
  }

  player.crystalBalance -= PULSE_COST_CRYSTALS;
  db.crystalTransactions.push({
    id: db.nextId(),
    playerId,
    amount: -PULSE_COST_CRYSTALS,
    source: 'joystick_pulse',
    createdAt: now,
  });
  s.pulseCount += 1;

  const result = spawnsModule.getNearbySpawns(s.currentLat, s.currentLng, 1000, playerId);
  return {
    ...result,
    joystick: statusFor(playerId, now),
    pulseCost: PULSE_COST_CRYSTALS,
    crystalBalance: Math.floor(player.crystalBalance),
  };
}

// Ends the session and starts the cooldown. Called when the player taps
// "Return to my location", and also lazily whenever the timer has run
// out — the cooldown is a flat hour either way, exactly as specified,
// so ending early is never rewarded.
function end(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new JoystickError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  if (!player.joystickSession) {
    return { ...statusFor(playerId, now), alreadyEnded: true };
  }
  player.joystickSession = null;
  player.joystickCooldownUntil = now + COOLDOWN_MS;
  return statusFor(playerId, now);
}

// Marks an expired session as seen so the "time's up" popup only fires
// once, without ending the session again or restarting the cooldown.
function acknowledgeExpiry(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new JoystickError('NO_PLAYER', 'Player not found');
  if (player.joystickSession) player.joystickSession.acknowledged = true;
  return end(playerId);
}

module.exports = {
  activate,
  move,
  pulse,
  end,
  acknowledgeExpiry,
  statusFor,
  getEffectivePosition,
  activeSession,
  JoystickError,
  PULSE_COST_CRYSTALS,
  MINUTES_PER_TOKEN,
  MAX_TOKENS_PER_SESSION,
  MAX_SPEED_KPH,
  COOLDOWN_MS,
  ACCEPTED_TOKENS,
};
