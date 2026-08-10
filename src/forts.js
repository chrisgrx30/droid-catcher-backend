// forts.js
//
// FORTS — guild-held structures pinned to real-world coordinates.
//
// STAGE 1 SCOPE (this file)
//   - Build a Fort at your real position
//   - Garrison droids into it (2 on creation, up to the slot cap)
//   - Territory listing for the guild
//   - Forts appear on the Overdrive map for everyone
//
// Takeover battles, shields, levelling and upgrade slots come in later
// stages. The data model here already carries the fields those stages
// need (shield, level, upgradeSlots, tokenRewardUntil) so stage 2 slots
// in without a migration.
//
// WHY GARRISONED DROIDS ARE LOCKED
// A droid in a Fort can't farm, battle or be merged. Without that, a
// Fort would be free value — you'd garrison your whole roster and lose
// nothing. Making it a real cost is what gives holding territory weight.

const db = require('./db');
const geo = require('./geo');

// ---- tuning ----
const BUILD_COST_CRYSTALS = 500000;
const MAX_SELF_BUILT_FORTS = 5;      // per guild; captured forts don't count
const BASE_DROID_SLOTS = 10;
const MIN_DROIDS_ON_BUILD = 2;
const BUILD_RADIUS_METERS = 40;      // must match the capture radius
const MIN_FORT_SEPARATION_METERS = 300;
const ASSIGN_COST_ON_CAPTURE = 1000; // per droid, used in stage 3

// Shield and reward fields exist now so later stages don't need a
// migration pass over saved forts.
const BASE_SHIELD = 50000;
const TOKEN_REWARD_DAYS = 7;
const TOKEN_EXTEND_COST = 100000;

const forts = new Map(); // id -> fort

class FortError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function guildFortsOf(guildId) {
  return [...forts.values()].filter((f) => f.guildId === guildId);
}

function selfBuiltCount(guildId) {
  return guildFortsOf(guildId).filter((f) => f.foundedByGuildId === guildId).length;
}

function garrisonOf(fort) {
  return fort.droidIds || (fort.droidIds = []);
}

// A droid is "busy" if it's doing anything else. Checked before it can
// be garrisoned, and checked in reverse by the other systems.
function assertDroidFree(player, droid) {
  if (!droid || droid.playerId !== player.id) throw new FortError('NO_DROID', 'Droid not found');
  if (droid.workshopSlotId) throw new FortError('IN_WORKSHOP', `${droid.id}: remove it from its workshop slot first`);
  if (player.companionDroidId === droid.id) throw new FortError('IS_COMPANION', 'That droid is your active companion');
  if (player.buddyDroidId === droid.id) throw new FortError('IS_BUDDY', 'That droid is your mastery buddy');
  if (droid.fortId) throw new FortError('ALREADY_GARRISONED', 'That droid is already in a Fort');
}

function build(playerId, lat, lng, name, payWith = 'crystals') {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  if (!player.guildId) throw new FortError('NO_GUILD', 'You need to be in a guild to build a Fort');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new FortError('BAD_POSITION', 'Could not read your position');

  if (selfBuiltCount(player.guildId) >= MAX_SELF_BUILT_FORTS) {
    throw new FortError('MAX_FORTS', `Your guild already holds the maximum of ${MAX_SELF_BUILT_FORTS} self-built Forts`);
  }

  // Forts can't be stacked on top of each other, or a guild could ring
  // one spot with five and make it untakeable.
  for (const f of forts.values()) {
    const d = geo.distanceMeters(lat, lng, f.lat, f.lng);
    if (d < MIN_FORT_SEPARATION_METERS) {
      throw new FortError('TOO_CLOSE', `There's already a Fort ${Math.round(d)}m away — Forts must be at least ${MIN_FORT_SEPARATION_METERS}m apart`);
    }
  }

  // Payment: a Fort Token (admin-gifted, to seed the feature) or crystals.
  if (payWith === 'token') {
    if ((player.fortTokens || 0) < 1) throw new FortError('NO_TOKEN', "You don't have a Fort Token");
    player.fortTokens -= 1;
  } else {
    if ((player.crystalBalance || 0) < BUILD_COST_CRYSTALS) {
      throw new FortError('NOT_ENOUGH_CRYSTALS', `Building a Fort costs ${BUILD_COST_CRYSTALS.toLocaleString()} crystals or 1 Fort Token`);
    }
    player.crystalBalance -= BUILD_COST_CRYSTALS;
    db.crystalTransactions.push({
      id: db.nextId(), playerId, amount: -BUILD_COST_CRYSTALS, source: 'fort_build', createdAt: Date.now(),
    });
  }

  const now = Date.now();
  const guild = db.guilds.get(player.guildId);
  const fort = {
    id: db.nextId(),
    name: (name || `${guild ? guild.name : 'Guild'} Fort`).slice(0, 40),
    lat, lng,
    guildId: player.guildId,
    foundedByGuildId: player.guildId,
    foundedByPlayerId: playerId,
    createdAt: now,
    droidIds: [],
    droidSlots: BASE_DROID_SLOTS,
    level: 1,
    // Fields stage 2/3 will use — present from the start so saved forts
    // never need migrating.
    shield: BASE_SHIELD,
    maxShield: BASE_SHIELD,
    upgradeSlots: [],
    upgradeSlotCount: 0,
    underAttack: false,
    tokenRewardUntil: now + TOKEN_REWARD_DAYS * 24 * 60 * 60 * 1000,
    lastTokenPayoutDay: null,
  };
  forts.set(fort.id, fort);
  return fort;
}

// Garrison droids. The player must be near the Fort ONLY when founding
// it — guildmates reinforce from anywhere, per the spec.
function assignDroids(playerId, fortId, droidIds, requireProximity = false, playerLat = null, playerLng = null) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  if (!Array.isArray(droidIds) || !droidIds.length) throw new FortError('NO_DROIDS', 'Select at least one droid');

  if (requireProximity) {
    if (!Number.isFinite(playerLat) || !Number.isFinite(playerLng)) throw new FortError('BAD_POSITION', 'Could not read your position');
    const d = geo.distanceMeters(playerLat, playerLng, fort.lat, fort.lng);
    if (d > BUILD_RADIUS_METERS) throw new FortError('TOO_FAR', `You need to be within ${BUILD_RADIUS_METERS}m of the Fort — you're ${Math.round(d)}m away`);
  }

  const garrison = garrisonOf(fort);
  if (garrison.length + droidIds.length > fort.droidSlots) {
    throw new FortError('FORT_FULL', `That Fort holds ${fort.droidSlots} droids and already has ${garrison.length}`);
  }

  // Validate every droid BEFORE locking any, so a bad one can't leave
  // half the selection garrisoned.
  const droids = droidIds.map((id) => {
    const d = db.ownedDroids.get(id);
    assertDroidFree(player, d);
    return d;
  });

  droids.forEach((d) => {
    d.fortId = fort.id;
    garrison.push(d.id);
  });
  return fort;
}

function withdrawDroid(playerId, fortId, droidId) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  if (fort.underAttack) throw new FortError('UNDER_ATTACK', "You can't withdraw droids while the Fort is under attack");

  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new FortError('NO_DROID', 'That droid is not yours');
  const garrison = garrisonOf(fort);
  const i = garrison.indexOf(droidId);
  if (i === -1) throw new FortError('NOT_IN_FORT', 'That droid is not in this Fort');

  garrison.splice(i, 1);
  droid.fortId = null;
  return fort;
}

// Enriched view. `viewerGuildId` decides whether this is friendly
// territory or a target.
function fortView(fort, viewerGuildId = null, workshop = null) {
  const guild = db.guilds.get(fort.guildId);
  const enrich = workshop || require('./workshop');
  const garrison = garrisonOf(fort).map((id) => {
    const d = db.ownedDroids.get(id);
    if (!d) return null;
    const e = enrich.enrichDroid(d);
    return {
      id: d.id, speciesName: e.speciesName, level: e.level, rarity: e.rarity,
      hp: e.hp, currentHp: e.currentHp, fainted: e.fainted,
      ownerId: d.playerId,
    };
  }).filter(Boolean);

  return {
    id: fort.id,
    name: fort.name,
    lat: fort.lat,
    lng: fort.lng,
    guildId: fort.guildId,
    guildName: guild ? guild.name : 'Unknown',
    isOwn: viewerGuildId != null && fort.guildId === viewerGuildId,
    captured: fort.foundedByGuildId !== fort.guildId,
    level: fort.level,
    droidSlots: fort.droidSlots,
    droidCount: garrison.length,
    activeDroids: garrison.filter((d) => !d.fainted).length,
    garrison,
    shield: fort.shield,
    maxShield: fort.maxShield,
    shieldPercent: fort.maxShield ? Math.round((fort.shield / fort.maxShield) * 100) : 0,
    upgradeSlotCount: fort.upgradeSlotCount,
    upgradeSlots: fort.upgradeSlots,
    underAttack: Boolean(fort.underAttack),
    tokenRewardUntil: fort.tokenRewardUntil,
    tokenDaysLeft: Math.max(0, Math.ceil((fort.tokenRewardUntil - Date.now()) / (24 * 60 * 60 * 1000))),
    createdAt: fort.createdAt,
  };
}

// Forts near a scan position, for the Overdrive map. Everyone sees every
// Fort in range — that's the point of territory.
function nearbyForts(lat, lng, radiusMeters, viewerGuildId = null) {
  const out = [];
  for (const fort of forts.values()) {
    const d = geo.distanceMeters(lat, lng, fort.lat, fort.lng);
    if (d <= radiusMeters) {
      out.push({ ...fortView(fort, viewerGuildId), distanceMeters: Math.round(d), inRange: d <= BUILD_RADIUS_METERS });
    }
  }
  return out.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function territoryFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  if (!player.guildId) {
    return { hasGuild: false, forts: [], built: 0, captured: 0, maxSelfBuilt: MAX_SELF_BUILT_FORTS, buildCost: BUILD_COST_CRYSTALS, fortTokens: player.fortTokens || 0 };
  }
  const list = guildFortsOf(player.guildId).map((f) => fortView(f, player.guildId));
  return {
    hasGuild: true,
    forts: list,
    built: list.filter((f) => !f.captured).length,
    captured: list.filter((f) => f.captured).length,
    maxSelfBuilt: MAX_SELF_BUILT_FORTS,
    buildCost: BUILD_COST_CRYSTALS,
    buildRadius: BUILD_RADIUS_METERS,
    minDroidsOnBuild: MIN_DROIDS_ON_BUILD,
    fortTokens: player.fortTokens || 0,
  };
}

// Droids a player could put into a Fort right now.
function garrisonCandidates(playerId) {
  const player = db.players.get(playerId);
  if (!player) return [];
  const workshop = require('./workshop');
  return [...db.ownedDroids.values()]
    .filter((d) => d.playerId === playerId && !d.fortId && !d.workshopSlotId
      && player.companionDroidId !== d.id && player.buddyDroidId !== d.id)
    .map((d) => {
      const e = workshop.enrichDroid(d);
      return { id: d.id, speciesName: e.speciesName, level: e.level, rarity: e.rarity, variant: d.variant, hp: e.hp, attack: e.attack, fainted: e.fainted };
    })
    .sort((a, b) => b.level - a.level);
}

// ---- persistence ----
function exportForts() {
  return [...forts.values()];
}
function importForts(rows) {
  forts.clear();
  (rows || []).forEach((f) => forts.set(f.id, f));
}

module.exports = {
  forts,
  BUILD_COST_CRYSTALS,
  MAX_SELF_BUILT_FORTS,
  BASE_DROID_SLOTS,
  MIN_DROIDS_ON_BUILD,
  BUILD_RADIUS_METERS,
  MIN_FORT_SEPARATION_METERS,
  ASSIGN_COST_ON_CAPTURE,
  BASE_SHIELD,
  TOKEN_REWARD_DAYS,
  TOKEN_EXTEND_COST,
  build,
  assignDroids,
  withdrawDroid,
  fortView,
  nearbyForts,
  territoryFor,
  garrisonCandidates,
  guildFortsOf,
  exportForts,
  importForts,
  FortError,
};
