// spawns.js
const db = require('./db');
const geo = require('./geo');

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

function isDaytime(lng, date = new Date()) {
  const hour = estimateLocalHour(lng, date);
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}

function markCellActive(lat, lng) {
  const cell = geo.cellId(lat, lng);
  activeCells.set(cell, Date.now());
  return cell;
}

function weightedRandomSpecies(refLng) {
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
    w *= db.getActiveEventMultiplier(sp, now); // time-exclusive event boost, if any
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
function trySpawnInCell(cell, refLng = 0) {
  const species = weightedRandomSpecies(refLng);
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
  };
  db.spawns.set(spawn.id, spawn);
  return spawn;
}

// Called when a player opens the map / requests nearby spawns.
function getNearbySpawns(lat, lng, radiusMeters = 500) {
  const cell = markCellActive(lat, lng);
  const cellsToCheck = geo.neighboringCells(lat, lng);

  // Lazily spawn in this cell if it's under its cap (stand-in for the
  // periodic background job — fine for a demo, use a real cron/worker
  // in production so spawns exist even before the first query).
  trySpawnInCell(cell, lng);

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
        minCrystalCost: db.MIN_CRYSTAL_COST[species.rarity],
        lat: spawn.lat,
        lng: spawn.lng,
        expiresAt: spawn.expiresAt,
        distanceMeters: Math.round(dist),
      });
    }
  }

  return {
    spawns: results,
    timeOfDay: isDaytime(lng) ? 'day' : 'night',
    estimatedLocalHour: Math.round(estimateLocalHour(lng) * 10) / 10,
    activeEvents: db.listActiveEvents(),
  };
}

// Cleanup pass — in production, Redis TTL does this for free.
function purgeExpiredSpawns() {
  const now = Date.now();
  for (const [key, spawn] of db.spawns.entries()) {
    if (spawn.expiresAt <= now) db.spawns.delete(key);
  }
}

module.exports = { getNearbySpawns, trySpawnInCell, purgeExpiredSpawns, markCellActive };
