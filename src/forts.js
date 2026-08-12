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
// 1 mile, per the revised spec — Forts should define a neighbourhood,
// not cluster on one street.
const MIN_FORT_SEPARATION_METERS = 1609;
// Each player may garrison at most this many droids in a single Fort,
// so one heavy hitter can't solo-wall a Fort and lock guildmates out.
const MAX_DROIDS_PER_PLAYER_PER_FORT = 2;
const ASSIGN_COST_ON_CAPTURE = 1000; // per droid, used in stage 3
const RENAME_COST = 10000;

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
  const mine = garrison.filter((id) => {
    const d = db.ownedDroids.get(id);
    return d && d.playerId === playerId;
  }).length;
  if (mine + droidIds.length > MAX_DROIDS_PER_PLAYER_PER_FORT) {
    throw new FortError('PLAYER_LIMIT', `You can only have ${MAX_DROIDS_PER_PLAYER_PER_FORT} droids in a single Fort — you already have ${mine} here`);
  }
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
    upgradeSlots: (fort.upgradeSlots || []).map((sl, i) => {
      let item = null;
      if (sl && sl.itemId) {
        try { item = require('./forge').BY_ID[sl.itemId] || null; } catch (e) {}
      }
      return { index: i, itemId: sl ? sl.itemId : null, takeoverSlot: Boolean(sl && sl.takeoverSlot), item };
    }),
    maxLevel: MAX_FORT_LEVEL,
    adjacency: adjacencyFor(fort),
    nextLevel: nextLevelFor(fort),
    tokenRate: fort.tokenRate || 1,
    defenderBonus: fort.defenderBonus || 0,
    underAttack: Boolean(fort.underAttack),
    tokenRewardUntil: fort.tokenRewardUntil,
    tokenDaysLeft: Math.max(0, Math.ceil((fort.tokenRewardUntil - Date.now()) / (24 * 60 * 60 * 1000))),
    createdAt: fort.createdAt,
    image: fort.image || null,
    imageBy: fort.imageBy || null,
    imagePending: Boolean(fort.pendingImage),
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


// ============================================================
// FORT LEVELLING (1 -> 13)
// ============================================================
// Paid for in Guild Tokens. The reward at each level comes straight
// from the supplied table:
//
//   upgradeSlot  — one more slot for a Forge item
//   droidSlot    — one more garrison space
//   shield       — +2% max shield
//   defender     — +2% defending droid stats
//   tokenRate    — daily Guild Token payout becomes N (does NOT stack;
//                  it REPLACES the previous rate, per the spec note)
//
// Level 13 is the capstone: double shield AND 5x tokens.
const FORT_LEVELS = [
  { level: 2,  cost: 100, reward: 'upgradeSlot', label: 'Fort upgrade slot x1' },
  { level: 3,  cost: 150, reward: 'droidSlot',   label: 'New droid slot' },
  { level: 4,  cost: 200, reward: 'shield',      value: 0.02, label: '+2% shield health' },
  { level: 5,  cost: 250, reward: 'defender',    value: 0.02, label: '+2% defending droid stats' },
  { level: 6,  cost: 300, reward: 'upgradeSlot', tokenRate: 2, label: 'Fort upgrade slot x1 & 2x tokens/day' },
  { level: 7,  cost: 350, reward: 'droidSlot',   label: 'New droid slot' },
  { level: 8,  cost: 400, reward: 'shield',      value: 0.02, label: '+2% shield health' },
  { level: 9,  cost: 450, reward: 'defender',    value: 0.02, label: '+2% defending droid stats' },
  { level: 10, cost: 500, reward: 'upgradeSlot', tokenRate: 3, label: 'Fort upgrade slot & 3x tokens/day' },
  { level: 11, cost: 550, reward: 'droidSlot',   label: 'New droid slot' },
  { level: 12, cost: 600, reward: 'shield',      value: 0.02, label: '+2% shield health' },
  { level: 13, cost: 650, reward: 'capstone',    tokenRate: 5, label: 'Double shield & 5x tokens/day' },
];
const MAX_FORT_LEVEL = 13;

function nextLevelFor(fort) {
  return FORT_LEVELS.find((l) => l.level === (fort.level || 1) + 1) || null;
}

// Guild Tokens are held by PLAYERS, not the guild, so levelling is
// crowd-funded: whoever presses the button pays. The spec's "all guild
// members can pay into this pot" is satisfied by anyone being able to
// take the next level.
function levelUpFort(playerId, fortId) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  if (fort.underAttack) throw new FortError('UNDER_ATTACK', "You can't upgrade a Fort while it's under attack");

  const next = nextLevelFor(fort);
  if (!next) throw new FortError('MAX_LEVEL', `That Fort is already at the maximum level ${MAX_FORT_LEVEL}`);
  if ((player.guildTokens || 0) < next.cost) {
    throw new FortError('NOT_ENOUGH_TOKENS', `Level ${next.level} costs ${next.cost} Guild Tokens — you have ${player.guildTokens || 0}`);
  }

  player.guildTokens -= next.cost;
  fort.level = next.level;

  switch (next.reward) {
    case 'upgradeSlot':
      fort.upgradeSlots = fort.upgradeSlots || [];
      fort.upgradeSlots.push({ index: fort.upgradeSlots.length, itemId: null, fittedAt: null });
      fort.upgradeSlotCount = fort.upgradeSlots.length;
      break;
    case 'droidSlot':
      fort.droidSlots += 1;
      break;
    case 'shield': {
      // Percentage of the BASE shield so repeated upgrades stay linear
      // rather than compounding into an unbreakable wall.
      const added = Math.round(BASE_SHIELD * next.value);
      fort.maxShield += added;
      fort.shield += added;
      break;
    }
    case 'defender':
      fort.defenderBonus = (fort.defenderBonus || 0) + next.value;
      break;
    case 'capstone':
      fort.maxShield *= 2;
      fort.shield = fort.maxShield;
      break;
    default: break;
  }

  // Token rate REPLACES rather than stacks, per the spec's note.
  if (next.tokenRate) fort.tokenRate = next.tokenRate;

  return fortView(fort, player.guildId);
}

// ---- upgrade slots ----
function fitUpgrade(playerId, fortId, slotIndex, itemId) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');

  const slot = (fort.upgradeSlots || [])[slotIndex];
  if (!slot) throw new FortError('NO_SLOT', 'That upgrade slot does not exist yet — level the Fort to unlock more');
  if (slot.itemId) throw new FortError('SLOT_FILLED', 'That slot already holds an upgrade');

  const forge = require('./forge');
  const item = forge.BY_ID[itemId];
  if (!item) throw new FortError('NO_ITEM', 'Unknown Forge item');
  // Apex consumables are battle items, not fort fittings.
  if (item.kind !== 'fort') throw new FortError('WRONG_KIND', `${item.name} is an Apex battle item, not a Fort upgrade`);

  forge.consume(playerId, itemId, 1);
  slot.itemId = itemId;
  slot.fittedAt = Date.now();
  slot.fittedBy = playerId;
  return fortView(fort, player.guildId);
}

// ---- daily Guild Token payout ----
// Paid once per UTC day to every member of the holding guild, and only
// while the Fort's reward window is open. Computed lazily on read
// rather than by a scheduler, so it still pays out correctly after
// Render has had the instance asleep.
function claimDailyTokens(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  if (!player.guildId) throw new FortError('NO_GUILD', 'You are not in a guild');

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  let granted = 0;
  const fromForts = [];

  guildFortsOf(player.guildId).forEach((fort) => {
    if (now > fort.tokenRewardUntil) return; // window expired, needs extending
    fort.tokenClaims = fort.tokenClaims || {};
    if (fort.tokenClaims[playerId] === today) return; // already claimed today
    const rate = fort.tokenRate || 1;
    fort.tokenClaims[playerId] = today;
    granted += rate;
    fromForts.push({ fortId: fort.id, name: fort.name, tokens: rate });
  });

  if (!granted) {
    throw new FortError('NOTHING_TO_CLAIM', "You've already claimed today, or your Forts' reward windows have expired");
  }
  player.guildTokens = (player.guildTokens || 0) + granted;
  return { granted, fromForts, guildTokens: player.guildTokens };
}

// Extending the reward window — 100,000 crystals for another 7 days.
function extendTokenWindow(playerId, fortId) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  if ((player.crystalBalance || 0) < TOKEN_EXTEND_COST) {
    throw new FortError('NOT_ENOUGH_CRYSTALS', `Extending costs ${TOKEN_EXTEND_COST.toLocaleString()} crystals — any guild member can pay`);
  }
  player.crystalBalance -= TOKEN_EXTEND_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -TOKEN_EXTEND_COST, source: 'fort_token_extend', createdAt: Date.now() });
  // Extend from the later of now or the existing expiry, so paying early
  // never loses days.
  fort.tokenRewardUntil = Math.max(Date.now(), fort.tokenRewardUntil) + TOKEN_REWARD_DAYS * 24 * 60 * 60 * 1000;
  return fortView(fort, player.guildId);
}


function renameFort(playerId, fortId, name) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  const clean = String(name || '').trim().slice(0, 40);
  if (clean.length < 3) throw new FortError('BAD_NAME', 'Fort names need at least 3 characters');
  if ((player.crystalBalance || 0) < RENAME_COST) {
    throw new FortError('NOT_ENOUGH_CRYSTALS', `Renaming a Fort costs ${RENAME_COST.toLocaleString()} crystals`);
  }
  player.crystalBalance -= RENAME_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -RENAME_COST, source: 'fort_rename', createdAt: Date.now() });
  fort.name = clean;
  return fortView(fort, player.guildId);
}

// ---- adjacency bonuses ----
// Forts held by the SAME guild within ADJACENCY_RADIUS_M of each other
// reinforce one another. This turns territory into a shape you read on
// a map rather than a list you hold: building your second Fort five
// miles from the first is a different decision to building it fifty.
//
// Deliberately capped. Without a cap a guild would ring one city in
// five Forts and make each unkillable, which is the opposite of what
// contested territory should feel like.
const ADJACENCY_RADIUS_M = 8000;        // ~5 miles
const ADJACENCY_BONUS_PER_NEIGHBOUR = 0.06; // +6% shield and defenders
const ADJACENCY_MAX_NEIGHBOURS = 3;

function adjacencyFor(fort) {
  let neighbours = 0;
  for (const other of forts.values()) {
    if (other.id === fort.id) continue;
    if (other.guildId !== fort.guildId) continue;
    if (geo.distanceMeters(fort.lat, fort.lng, other.lat, other.lng) <= ADJACENCY_RADIUS_M) neighbours++;
  }
  const counted = Math.min(neighbours, ADJACENCY_MAX_NEIGHBOURS);
  return {
    neighbours,
    counted,
    bonus: counted * ADJACENCY_BONUS_PER_NEIGHBOUR,
    percent: Math.round(counted * ADJACENCY_BONUS_PER_NEIGHBOUR * 100),
    radiusKm: Math.round(ADJACENCY_RADIUS_M / 1000),
    maxNeighbours: ADJACENCY_MAX_NEIGHBOURS,
  };
}


// ---- fort location photos ----
// Players submit a photo of the real place; an admin approves it before
// anyone else sees it. Moderation is the whole point — an unmoderated
// image attached to a real-world coordinate is a genuine safety problem,
// not just a quality one.
//
// Images are stored as data URLs on the fort record. Capped hard,
// because these go into the Upstash snapshot and a few unbounded photos
// would blow the save size for everyone.
const MAX_FORT_IMAGE_CHARS = 220000; // ~160KB of base64

function submitFortImage(playerId, fortId, dataUrl) {
  const player = db.players.get(playerId);
  if (!player) throw new FortError('NO_PLAYER', 'Player not found');
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new FortError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) {
    throw new FortError('BAD_IMAGE', 'That file was not a valid image');
  }
  if (dataUrl.length > MAX_FORT_IMAGE_CHARS) {
    throw new FortError('IMAGE_TOO_BIG', 'That image is too large — please use one under about 150KB');
  }
  fort.pendingImage = { dataUrl, submittedBy: playerId, submittedByName: player.username, submittedAt: Date.now() };
  return { submitted: true, fortId, fortName: fort.name };
}

function pendingFortImages() {
  const out = [];
  for (const fort of forts.values()) {
    if (fort.pendingImage) {
      const guild = db.guilds.get(fort.guildId);
      out.push({
        fortId: fort.id,
        fortName: fort.name,
        guildName: guild ? guild.name : 'Unknown',
        lat: fort.lat,
        lng: fort.lng,
        ...fort.pendingImage,
      });
    }
  }
  return out.sort((a, b) => a.submittedAt - b.submittedAt);
}

function reviewFortImage(fortId, approve) {
  const fort = forts.get(fortId);
  if (!fort) throw new FortError('NO_FORT', 'Fort not found');
  if (!fort.pendingImage) throw new FortError('NO_PENDING', 'No image is awaiting review for that Fort');
  const sub = fort.pendingImage;
  fort.pendingImage = null;
  if (approve) {
    fort.image = sub.dataUrl;
    fort.imageBy = sub.submittedByName;
  }
  return { fortId, approved: Boolean(approve), submittedBy: sub.submittedByName };
}

// Admin overview of every Fort in the world.
function allFortsForAdmin() {
  return [...forts.values()].map((f) => {
    const guild = db.guilds.get(f.guildId);
    return {
      id: f.id, name: f.name, lat: f.lat, lng: f.lng,
      guildName: guild ? guild.name : 'Unknown',
      guildId: f.guildId,
      level: f.level,
      droidCount: (f.droidIds || []).length,
      droidSlots: f.droidSlots,
      shieldPercent: f.maxShield ? Math.round((f.shield / f.maxShield) * 100) : 0,
      underAttack: Boolean(f.underAttack),
      captured: f.foundedByGuildId !== f.guildId,
      hasImage: Boolean(f.image),
      pendingImage: Boolean(f.pendingImage),
      createdAt: f.createdAt,
      tokenDaysLeft: Math.max(0, Math.ceil((f.tokenRewardUntil - Date.now()) / 86400000)),
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
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
  MAX_DROIDS_PER_PLAYER_PER_FORT,
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
  FORT_LEVELS,
  MAX_FORT_LEVEL,
  nextLevelFor,
  levelUpFort,
  fitUpgrade,
  claimDailyTokens,
  extendTokenWindow,
  renameFort,
  RENAME_COST,
  submitFortImage,
  pendingFortImages,
  reviewFortImage,
  allFortsForAdmin,
  MAX_FORT_IMAGE_CHARS,
  adjacencyFor,
  ADJACENCY_RADIUS_M,
  ADJACENCY_BONUS_PER_NEIGHBOUR,
  exportForts,
  importForts,
  FortError,
};
