// spawns.js
const db = require('./db');
const geo = require('./geo');
// Read the capture radius from the module that enforces it, rather than
// repeating the number here — otherwise the map and the server could
// disagree about which droids are reachable.
const { CAPTURE_RADIUS_METERS } = require('./capture');

// Tracks cells with recent player activity so we only spawn where players
// actually are (mirrors "active cell" logic from the design).
const activeCells = new Map(); // cellId -> lastSeenTimestamp
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

// ---- day/night alignment bias ----
// Rather than using the server's own clock (wrong for a global playerbase),
// estimate local solar time from longitude: roughly 15° of longitude per
// hour of UTC offset. Good enough for "is it light or dark out here" without
// needing a full timezone database.
const DAY_START_HOUR = 6;   // 6am local
const DAY_END_HOUR = 18;    // 6pm local
const ALIGNMENT_BIAS = 1.75; // favored alignment gets 1.75x weight, the other gets 1/1.75x

function estimateLocalHour(lng, date = new Date()) {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const localHour = ((utcHours + lng / 15) % 24 + 24) % 24;
  return localHour;
}

// Local day-of-week (0=Sun...6=Sat), correctly rolling into the adjacent
// day near midnight rather than just reusing the UTC day — needed for
// the football roster's "Saturday/Sunday only" spawn rule.
function estimateLocalDay(lng, date = new Date()) {
  const offsetMs = (lng / 15) * 60 * 60 * 1000;
  const shifted = new Date(date.getTime() + offsetMs);
  return shifted.getUTCDay();
}

function isDaytime(lng, date = new Date()) {
  const hour = estimateLocalHour(lng, date);
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}

// Football roster spawn window: Light 3-5pm, Dark 8-10pm, Saturday and
// Sunday only, computed from the same local-time estimation used
// everywhere else — additive to the pool only while active, so it never
// dilutes any other collection's odds outside its window (same
// non-destructive property as the Solar grant mechanism).
function isFootballWindowActive(alignment, lng, date = new Date()) {
  const window = db.FOOTBALL_WINDOWS[alignment];
  if (!window) return false;
  const localDay = estimateLocalDay(lng, date);
  const localHour = estimateLocalHour(lng, date);
  return window.days.includes(localDay) && localHour >= window.startHour && localHour < window.endHour;
}

// Same additive, non-destructive pattern as Football, but daily (no
// day-of-week gate) and handles the Zombie line's window wrapping past
// midnight (23-25 means 23:00-24:00 OR 0:00-1:00).
function isDailyLineWindowActive(collection, lng, date = new Date()) {
  const window = db.DAILY_LINE_WINDOWS[collection];
  if (!window) return false;
  const localHour = estimateLocalHour(lng, date);
  if (window.endHour > 24) {
    return localHour >= window.startHour || localHour < (window.endHour - 24);
  }
  return localHour >= window.startHour && localHour < window.endHour;
}

function markCellActive(lat, lng) {
  const cell = geo.cellId(lat, lng);
  activeCells.set(cell, Date.now());
  return cell;
}

function weightedRandomSpecies(refLng, beaconActive = false) {
  const daytime = isDaytime(refLng);
  const now = Date.now();
  const weights = db.droidSpecies.map((sp) => {
    let w = sp.spawnWeight;
    if (daytime) {
      if (sp.alignment === 'light') w *= ALIGNMENT_BIAS;
      if (sp.alignment === 'dark') w /= ALIGNMENT_BIAS;
    } else {
      if (sp.alignment === 'dark') w *= ALIGNMENT_BIAS;
      if (sp.alignment === 'light') w /= ALIGNMENT_BIAS;
    }
    w *= db.getActiveEventMultiplier(sp, now); // time-exclusive boost event, if any (multiplicative)
    w += db.getActiveEventGrant(sp, now); // time-exclusive grant event, if any (additive — works even at 0 base weight)
    if (sp.collection === 'football' && sp.footballWeight && isFootballWindowActive(sp.alignment, refLng)) {
      w += sp.footballWeight; // additive, same non-destructive pattern as the grant mechanism above
    }
    if (sp.dailyWeight && isDailyLineWindowActive(sp.collection, refLng)) {
      w += sp.dailyWeight;
    }
    if (beaconActive && ['rare', 'legendary', 'cosmic'].includes(sp.rarity)) {
      w *= db.BEACON_BOOST_MULTIPLIER;
    }
    return w;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < db.droidSpecies.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return db.droidSpecies[i];
  }
  return db.droidSpecies[db.droidSpecies.length - 1];
}

function countActiveSpawnsInCell(cell, rarity) {
  let count = 0;
  for (const spawn of db.spawns.values()) {
    if (spawn.cell === cell && !spawn.claimedBy && spawn.expiresAt > Date.now()) {
      const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
      if (species.rarity === rarity) count++;
    }
  }
  return count;
}

function countActiveLegendariesCityWide() {
  let count = 0;
  for (const spawn of db.spawns.values()) {
    if (!spawn.claimedBy && spawn.expiresAt > Date.now()) {
      const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
      if (species.rarity === 'legendary') count++;
    }
  }
  return count;
}

// Same city-wide idea as the cosmic cap: an Apex Hunt grants weight to
// all 30 Apex species at once, so without this a single busy cell could
// surface several at the same moment and undercut how rare they feel.
function countActiveApexCityWide() {
  let count = 0;
  for (const spawn of db.spawns.values()) {
    if (!spawn.claimedBy && spawn.expiresAt > Date.now()) {
      const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
      if (species && species.rarity === 'apex') count++;
    }
  }
  return count;
}

function countActiveCosmicsCityWide() {
  let count = 0;
  for (const spawn of db.spawns.values()) {
    if (!spawn.claimedBy && spawn.expiresAt > Date.now()) {
      const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
      if (species.rarity === 'cosmic') count++;
    }
  }
  return count;
}

// The "spawn job" — in production this runs on a timer (e.g. every 5 min)
// across all active cells. Here it's exposed as a function callable
// on-demand (invoked lazily when a player queries an active cell).
// refLng is used only to estimate local time-of-day for the light/dark bias.
function getSpawnBoostSource(species, beaconActive) {
  const now = Date.now();
  if (db.getActiveEventMultiplier(species, now) > 1 || db.getActiveEventGrant(species, now) > 0) return 'event';
  if (beaconActive && ['rare', 'legendary', 'cosmic'].includes(species.rarity)) return 'beacon';
  return null;
}

function trySpawnInCell(cell, refLng = 0, beaconActive = false) {
  const species = weightedRandomSpecies(refLng, beaconActive);
  const maxForRarity = db.RARITY_MAX_PER_CELL[species.rarity];

  if (countActiveSpawnsInCell(cell, species.rarity) >= maxForRarity) {
    return null; // cell already saturated for this rarity
  }
  if (species.rarity === 'legendary' && countActiveLegendariesCityWide() >= db.LEGENDARY_CITY_CAP) {
    return null; // city-wide legendary cap hit
  }
  if (species.rarity === 'cosmic' && countActiveCosmicsCityWide() >= db.COSMIC_CITY_CAP) {
    return null; // city-wide companion cap hit — only one StarSprite active anywhere at a time
  }
  if (species.rarity === 'apex' && countActiveApexCityWide() >= db.APEX_CITY_CAP) {
    return null; // only one Apex anywhere at a time, even during a Hunt
  }

  const point = geo.randomPointInCell(cell);
  const ttl = db.RARITY_TTL_MS[species.rarity];
  const spawn = {
    id: db.nextId(),
    speciesId: species.id,
    variant: db.rollVariant(species.rarity),
    lat: point.lat,
    lng: point.lng,
    cell,
    spawnedAt: Date.now(),
    expiresAt: Date.now() + ttl,
    claimedBy: null,
    boostSource: getSpawnBoostSource(species, beaconActive), // 'event' | 'beacon' | null — shown as a marker on the spawn card
  };
  db.spawns.set(spawn.id, spawn);
  return spawn;
}

// Called when a player opens the map / requests nearby spawns. playerId
// is optional (older calls without it just get no beacon boost).
function getNearbySpawns(lat, lng, radiusMeters = 500, playerId = null) {
  const cell = markCellActive(lat, lng);
  const cellsToCheck = geo.neighboringCells(lat, lng);
  const player = playerId ? db.players.get(playerId) : null;
  const beaconActive = player ? db.isBeaconActive(playerId) : false;
  if (beaconActive) {
    db.markCellBeaconBoosted(cell, player.beaconActiveUntil); // visible to anyone scanning this cell, not just the beacon holder
  }
  const cellBeaconActive = db.isCellBeaconBoosted(cell); // is ANYONE's beacon currently boosting this cell, mine or not

  // Concentrate generation in the player's OWN cell — neighboring cell
  // centers are already 150-212m away, so almost nothing generated
  // there can ever land within a typical tight scan radius (confirmed
  // by direct testing: 18 generation attempts spread evenly across all
  // 9 cells produced only 2 spawns within 100m). One lighter pass on
  // neighbors still helps wider-radius queries without wasting most of
  // the generation budget on points that can't be found nearby anyway.
  for (let i = 0; i < 8; i++) trySpawnInCell(cell, lng, beaconActive);
  cellsToCheck.filter((c) => c !== cell).forEach((c) => trySpawnInCell(c, lng, beaconActive));

  // Looked up once per scan rather than per spawn.

  const wishedIds = playerId ? db.wishedSpeciesIds(playerId) : new Set();

  const results = [];
  for (const spawn of db.spawns.values()) {
    if (spawn.claimedBy) continue;
    if (spawn.expiresAt <= Date.now()) continue;
    if (!cellsToCheck.includes(spawn.cell)) continue;

    const dist = geo.distanceMeters(lat, lng, spawn.lat, spawn.lng);
    if (dist <= radiusMeters) {
      const species = db.droidSpecies.find((s) => s.id === spawn.speciesId);
      results.push({
        id: spawn.id,
        speciesId: species.id,
        speciesName: species.name,
        rarity: species.rarity,
        alignment: species.alignment,
        collection: species.collection,
        variant: spawn.variant,
        isCompanion: species.isCompanion || false,
        minCrystalCost: db.scaledMinCrystalCost(species.rarity, playerId ? (db.players.get(playerId)?.padLevel || 0) : 0),
        lat: spawn.lat,
        lng: spawn.lng,
        expiresAt: spawn.expiresAt,
        distanceMeters: Math.round(dist),
        // Two-band radar: inside CAPTURE_RADIUS_METERS the player can run
        // the minigame; between that and the sweep radius the droid is
        // visible on the map only. Compared against the raw distance, not
        // the rounded one, so a droid at 15.4m doesn't display as "15m
        // away" while refusing to open.
        withinCaptureRadius: dist <= CAPTURE_RADIUS_METERS,
        // Star this spawn if it's a species the player has on their
        // wish list — so a wanted droid can't be walked past unnoticed.
        onWishlist: wishedIds.has(species.id),
        boostSource: spawn.boostSource,
      });
    }
  }

  return {
    spawns: results,
    // Sent to the client so the map ring and the "move closer" copy stay
    // in sync with the server automatically when this value is tuned.
    captureRadiusMeters: CAPTURE_RADIUS_METERS,
    timeOfDay: isDaytime(lng) ? 'day' : 'night',
    estimatedLocalHour: Math.round(estimateLocalHour(lng) * 10) / 10,
    activeEvents: db.listActiveEvents(),
    beaconActive,
    cellBeaconActive,
  };
}

// Cleanup pass — in production, Redis TTL does this for free.
function fleeSpawn(spawnId, playerId) {
  const spawn = db.spawns.get(spawnId);
  if (!spawn) throw new Error('Spawn not found');
  if (spawn.claimedBy) throw new Error('This spawn is no longer available');
  // Reuses the same claimedBy mechanism a real capture uses — the spawn
  // is permanently excluded from every future listing, exactly as
  // confirmed ("droid disappears and cannot go through the capture
  // loop again"). No reward or penalty either way.
  spawn.claimedBy = playerId;
  spawn.fledFrom = true; // distinguishes "you ran from this" from "someone actually captured it" in later error messages
  return { fled: true };
}

function purgeExpiredSpawns() {
  const now = Date.now();
  for (const [key, spawn] of db.spawns.entries()) {
    if (spawn.expiresAt <= now) db.spawns.delete(key);
  }
}

module.exports = { getNearbySpawns, trySpawnInCell, purgeExpiredSpawns, markCellActive, fleeSpawn };
