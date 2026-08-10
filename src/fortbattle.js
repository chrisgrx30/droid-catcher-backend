// fortbattle.js
//
// FORT SIEGES — taking a rival guild's Fort.
//
// TWO PHASES, IN ORDER
//   1. DROID phase — grind the garrison down. Defenders do NOT heal
//      between attacks; damage persists until the defending guild pays
//      to repair. That's what makes a siege a campaign rather than a
//      single fight.
//   2. SHIELD phase — only unlocks once every garrisoned droid has
//      fainted. The Fort's shield is a large HP pool with no counter-
//      attack; it's a crystal-and-time wall, not a fight.
//
// WHY ONE SORTIE AT A TIME
// Only one attack can be resolving against a Fort at any moment. Without
// that lock, two attackers could each read "shield 5,000" and both apply
// damage to the same snapshot, or two players could take the last droid
// down simultaneously and both trigger a capture. The lock is what makes
// coordinated guild attacks sequential and legible rather than a race.
//
// THE REVIVE RULE
// If the defenders revive a droid mid-siege, the Fort drops OUT of the
// shield phase and back to the droid phase. The spec calls for the guild
// battle box to flip from "safe" back to "attack", and this is that rule
// in code: shield damage already dealt is kept, so reviving buys time
// rather than undoing progress.

const db = require('./db');
const geo = require('./geo');
const forts = require('./forts');
const workshop = require('./workshop');
const battle = require('./battle');
const realtime = require('./realtime');

// ---- tuning ----
const INITIATE_COST = 500;      // starting a siege
const ATTACK_COST = 1000;       // every sortie after
const SHIELD_REPAIR_COST = 100000;
const DROID_REVIVE_COST = 10000; // per garrisoned droid, paid by the defending guild
const SIEGE_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // an untouched siege lapses
const SORTIE_TURN_LIMIT = 40;

const sieges = new Map(); // fortId -> siege

class SiegeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function activeSiegeFor(fortId) {
  const s = sieges.get(fortId);
  if (!s) return null;
  if (s.status !== 'active') return null;
  if (Date.now() - s.updatedAt > SIEGE_IDLE_TIMEOUT_MS) {
    // Lapsed. The Fort keeps its damage — abandoning a siege doesn't
    // heal the defenders, it just releases the lock.
    s.status = 'lapsed';
    const fort = forts.forts.get(fortId);
    if (fort) fort.underAttack = false;
    return null;
  }
  return s;
}

function garrisonDroids(fort) {
  return (fort.droidIds || []).map((id) => db.ownedDroids.get(id)).filter(Boolean);
}

function livingDefenders(fort) {
  return garrisonDroids(fort).filter((d) => !workshop.enrichDroid(d).fainted);
}

// Fort upgrades fitted into slots buff the defenders. Stage 3 fills
// upgradeSlots; this reads whatever is there so the two stages connect
// without a rewrite.
function fortDefenceMultipliers(fort) {
  // Level-derived defender bonus (from the +2% rewards) applies on top
  // of anything fitted into upgrade slots.
  let hp = 1 + (fort.defenderBonus || 0);
  let atk = 1 + (fort.defenderBonus || 0);
  let shield = 1;
  (fort.upgradeSlots || []).forEach((slot) => {
    if (!slot || !slot.itemId) return;
    try {
      const item = require('./forge').BY_ID[slot.itemId];
      if (!item) return;
      if (item.effect === 'defenderHp') hp += item.value;
      if (item.effect === 'defenderAtk') atk += item.value;
      if (item.effect === 'shield') shield += item.value;
    } catch (e) {}
  });
  return { hp, atk, shield };
}

// ---- starting a siege ----
function initiate(fortId, playerId, teamDroidIds, playerLat, playerLng) {
  const player = db.players.get(playerId);
  if (!player) throw new SiegeError('NO_PLAYER', 'Player not found');
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  if (!player.guildId) throw new SiegeError('NO_GUILD', 'You need a guild to attack a Fort');
  if (fort.guildId === player.guildId) throw new SiegeError('OWN_FORT', "That's your own guild's Fort");

  if (activeSiegeFor(fortId)) throw new SiegeError('ALREADY_UNDER_ATTACK', 'This Fort is already under attack — wait for that assault to finish');

  // Proximity: the initiating player must be in range, OR using a live
  // Joy Stick session (which the spec explicitly allows).
  const joystick = require('./joystick');
  const pos = joystick.getEffectivePosition(player, playerLat, playerLng);
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) throw new SiegeError('BAD_POSITION', 'Could not read your position');
  const dist = geo.distanceMeters(pos.lat, pos.lng, fort.lat, fort.lng);
  if (dist > forts.BUILD_RADIUS_METERS) {
    throw new SiegeError('TOO_FAR', `You need to be within ${forts.BUILD_RADIUS_METERS}m of the Fort to start an assault — you're ${Math.round(dist)}m away`);
  }

  if ((player.crystalBalance || 0) < INITIATE_COST) {
    throw new SiegeError('NOT_ENOUGH_CRYSTALS', `Starting an assault costs ${INITIATE_COST} crystals`);
  }
  const team = battle.validateTeam(playerId, teamDroidIds);

  player.crystalBalance -= INITIATE_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -INITIATE_COST, source: 'fort_initiate', createdAt: Date.now() });

  const siege = {
    fortId,
    attackerGuildId: player.guildId,
    initiatedBy: playerId,
    status: 'active',
    phase: livingDefenders(fort).length ? 'droids' : 'shield',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    sortie: null,          // the in-progress attack, if any
    log: [],
    shieldDamage: 0,
    attackersInvolved: [playerId],
  };
  sieges.set(fortId, siege);
  fort.underAttack = true;

  notifyDefenders(fort, 'fort:attacked', {
    fortId, fortName: fort.name,
    attackerGuildId: player.guildId,
    attackerName: player.username,
  });

  return viewSiege(fort, siege, player.guildId);
}

// ---- a single sortie: one attacking team vs the garrison ----
function startSortie(fortId, playerId, teamDroidIds) {
  const player = db.players.get(playerId);
  if (!player) throw new SiegeError('NO_PLAYER', 'Player not found');
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  const siege = activeSiegeFor(fortId);
  if (!siege) throw new SiegeError('NO_SIEGE', 'No assault is running on that Fort — start one from the map');
  if (siege.attackerGuildId !== player.guildId) throw new SiegeError('NOT_YOUR_SIEGE', 'Another guild is assaulting this Fort');
  if (siege.sortie && siege.sortie.status === 'active') {
    throw new SiegeError('SORTIE_IN_PROGRESS', `${db.players.get(siege.sortie.playerId).username} is mid-attack — wait for it to finish`);
  }
  if (siege.phase !== 'droids') throw new SiegeError('WRONG_PHASE', 'The garrison is down — attack the shield instead');

  if ((player.crystalBalance || 0) < ATTACK_COST) {
    throw new SiegeError('NOT_ENOUGH_CRYSTALS', `Each attack costs ${ATTACK_COST} crystals`);
  }
  const team = battle.validateTeam(playerId, teamDroidIds);

  player.crystalBalance -= ATTACK_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -ATTACK_COST, source: 'fort_attack', createdAt: Date.now() });
  if (!siege.attackersInvolved.includes(playerId)) siege.attackersInvolved.push(playerId);

  siege.sortie = {
    playerId,
    teamIds: team.map((d) => d.id),
    activeIndex: battle.firstNonFaintedIndex(team),
    defenderIndex: 0,
    status: 'active',
    turn: 0,
    startedAt: Date.now(),
  };
  siege.updatedAt = Date.now();
  return viewSiege(fort, siege, player.guildId);
}

function attack(fortId, playerId) {
  const player = db.players.get(playerId);
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  const siege = activeSiegeFor(fortId);
  if (!siege) throw new SiegeError('NO_SIEGE', 'No assault is running');
  const sortie = siege.sortie;
  if (!sortie || sortie.status !== 'active') throw new SiegeError('NO_SORTIE', 'Start an attack first');
  if (sortie.playerId !== playerId) throw new SiegeError('NOT_YOUR_ATTACK', 'This attack belongs to another player');

  const defenders = garrisonDroids(fort);
  const alive = defenders.filter((d) => !workshop.enrichDroid(d).fainted);
  if (!alive.length) {
    siege.phase = 'shield';
    sortie.status = 'finished';
    return viewSiege(fort, siege, player.guildId);
  }

  const mult = fortDefenceMultipliers(fort);
  const myTeam = sortie.teamIds.map((id) => db.ownedDroids.get(id));
  const attacker = myTeam[sortie.activeIndex];
  const defender = alive[0];

  const atkStats = workshop.enrichDroid(attacker);
  const defStats = workshop.enrichDroid(defender);
  // Fort HP bonus raises the effective pool a defender must lose before
  // fainting. Applied as a damage reduction rather than by rewriting the
  // droid's stats, so the buff is local to this Fort and vanishes if the
  // droid is withdrawn.
  const hpSoak = mult.hp > 1 ? 1 / mult.hp : 1;

  // Attacker hits.
  const variance = 1 + (Math.random() * 2 - 1) * battle.DAMAGE_VARIANCE;
  const damage = Math.max(1, Math.round(atkStats.attack * variance * hpSoak));
  defender.currentHpDamage = (defender.currentHpDamage || 0) + damage;
  const defenderNow = workshop.enrichDroid(defender);
  const defenderDown = defenderNow.fainted;

  const entry = {
    turn: ++sortie.turn,
    attackerPlayerId: playerId,
    attackerName: atkStats.speciesName,
    defenderName: defStats.speciesName,
    damage,
    defenderDown,
    at: Date.now(),
  };

  // Defender counters, buffed by any fitted Fort upgrades.
  if (!defenderDown) {
    const counterVariance = 1 + (Math.random() * 2 - 1) * battle.DAMAGE_VARIANCE;
    const counter = Math.max(1, Math.round(defStats.attack * mult.atk * counterVariance));
    attacker.currentHpDamage = (attacker.currentHpDamage || 0) + counter;
    entry.counterDamage = counter;
    entry.attackerDown = workshop.enrichDroid(attacker).fainted;

    if (entry.attackerDown) {
      const next = battle.firstNonFaintedIndex(myTeam);
      if (next === -1) {
        sortie.status = 'repelled';
        entry.sortieRepelled = true;
      } else {
        sortie.activeIndex = next;
      }
    }
  }

  siege.log.push(entry);
  if (siege.log.length > 60) siege.log.shift();
  siege.updatedAt = Date.now();

  // Garrison wiped -> shield phase unlocks.
  const stillAlive = garrisonDroids(fort).filter((d) => !workshop.enrichDroid(d).fainted);
  if (!stillAlive.length) {
    siege.phase = 'shield';
    sortie.status = 'finished';
    entry.garrisonCleared = true;
    notifyDefenders(fort, 'fort:garrison-down', { fortId, fortName: fort.name });
  } else if (sortie.turn >= SORTIE_TURN_LIMIT && sortie.status === 'active') {
    // A stalemate ends the sortie rather than running forever.
    sortie.status = 'repelled';
    entry.sortieRepelled = true;
  }

  if (sortie.status === 'repelled') {
    notifyDefenders(fort, 'fort:repelled', { fortId, fortName: fort.name });
  }

  return { ...viewSiege(fort, siege, player.guildId), lastAction: entry };
}

// ---- shield phase ----
function attackShield(fortId, playerId, teamDroidIds) {
  const player = db.players.get(playerId);
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  const siege = activeSiegeFor(fortId);
  if (!siege) throw new SiegeError('NO_SIEGE', 'No assault is running');
  if (siege.attackerGuildId !== player.guildId) throw new SiegeError('NOT_YOUR_SIEGE', 'Another guild is assaulting this Fort');
  if (siege.phase !== 'shield') throw new SiegeError('WRONG_PHASE', 'The garrison is still standing — defeat every droid first');

  if ((player.crystalBalance || 0) < ATTACK_COST) {
    throw new SiegeError('NOT_ENOUGH_CRYSTALS', `Each shield strike costs ${ATTACK_COST} crystals`);
  }
  const team = battle.validateTeam(playerId, teamDroidIds);

  player.crystalBalance -= ATTACK_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -ATTACK_COST, source: 'fort_shield', createdAt: Date.now() });
  if (!siege.attackersInvolved.includes(playerId)) siege.attackersInvolved.push(playerId);

  // The whole team hits the shield at once — there's nothing to counter,
  // so a turn-by-turn exchange would just be padding.
  const total = team.reduce((sum, d) => {
    const e = workshop.enrichDroid(d);
    return sum + (e.fainted ? 0 : e.attack);
  }, 0);
  const variance = 1 + (Math.random() * 2 - 1) * battle.DAMAGE_VARIANCE;
  // x8 rather than raw team attack. Measured at x3 a 4-strong level-14
  // team needed 65 strikes to drop a 50,000 shield — 65,000 crystals and
  // 65 taps, which is tedium rather than difficulty. At x8 the same team
  // needs roughly 24, so the shield is still a real wall (a full second
  // phase costing ~24,000 crystals) without being a chore.
  const damage = Math.max(1, Math.round(total * 8 * variance));

  fort.shield = Math.max(0, fort.shield - damage);
  siege.shieldDamage += damage;
  siege.updatedAt = Date.now();

  const entry = {
    turn: siege.log.length + 1,
    attackerPlayerId: playerId,
    shieldDamage: damage,
    shieldLeft: fort.shield,
    at: Date.now(),
  };
  siege.log.push(entry);

  // Fort upgrades are destroyed one per shield strike, newest first.
  let destroyed = null;
  if ((fort.upgradeSlots || []).length) {
    const filled = fort.upgradeSlots.filter((s) => s && s.itemId);
    if (filled.length) {
      const newest = filled[filled.length - 1];
      destroyed = newest.itemId;
      newest.itemId = null;
      newest.fittedAt = null;
      entry.upgradeDestroyed = destroyed;
    }
  }

  if (fort.shield <= 0) {
    siege.phase = 'breached';
    entry.breached = true;
    notifyDefenders(fort, 'fort:breached', { fortId, fortName: fort.name });
  }

  return { ...viewSiege(fort, siege, player.guildId), lastAction: entry };
}

// ---- defending ----
function reviveDroid(fortId, playerId, droidId) {
  const player = db.players.get(playerId);
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new SiegeError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.fortId !== fortId) throw new SiegeError('NOT_IN_FORT', 'That droid is not in this Fort');
  if (!workshop.enrichDroid(droid).fainted) throw new SiegeError('NOT_FAINTED', 'That droid is already standing');

  if ((player.crystalBalance || 0) < DROID_REVIVE_COST) {
    throw new SiegeError('NOT_ENOUGH_CRYSTALS', `Reviving a garrison droid costs ${DROID_REVIVE_COST.toLocaleString()} crystals`);
  }
  player.crystalBalance -= DROID_REVIVE_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -DROID_REVIVE_COST, source: 'fort_revive', createdAt: Date.now() });
  droid.currentHpDamage = 0;

  // Reviving pulls the Fort back out of the shield phase — the box flips
  // from "safe" to "attack" again, exactly as the spec describes.
  const siege = activeSiegeFor(fortId);
  if (siege && siege.phase === 'shield') {
    siege.phase = 'droids';
    siege.log.push({ turn: siege.log.length + 1, revived: true, by: playerId, at: Date.now() });
    siege.updatedAt = Date.now();
    notifyAttackers(siege, 'fort:revived', { fortId, fortName: fort.name });
  }
  return { fort: forts.fortView(fort, player.guildId), phase: siege ? siege.phase : null };
}

function repairShield(fortId, playerId) {
  const player = db.players.get(playerId);
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  if (fort.guildId !== player.guildId) throw new SiegeError('NOT_YOUR_FORT', 'That Fort belongs to another guild');
  if (fort.shield >= fort.maxShield) throw new SiegeError('SHIELD_FULL', 'That shield is already at full strength');

  if ((player.crystalBalance || 0) < SHIELD_REPAIR_COST) {
    throw new SiegeError('NOT_ENOUGH_CRYSTALS', `Repairing the shield costs ${SHIELD_REPAIR_COST.toLocaleString()} crystals — any guild member can pay`);
  }
  player.crystalBalance -= SHIELD_REPAIR_COST;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -SHIELD_REPAIR_COST, source: 'fort_shield_repair', createdAt: Date.now() });
  fort.shield = fort.maxShield;

  const siege = activeSiegeFor(fortId);
  if (siege && siege.phase === 'breached') siege.phase = 'shield';
  return { fort: forts.fortView(fort, player.guildId) };
}

// ---- capture ----
function capture(fortId, playerId, droidIds, playerLat, playerLng) {
  const player = db.players.get(playerId);
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  const siege = activeSiegeFor(fortId);
  if (!siege || siege.phase !== 'breached') throw new SiegeError('NOT_BREACHED', 'The Fort has to be breached before you can take it');
  if (siege.attackerGuildId !== player.guildId) throw new SiegeError('NOT_YOUR_SIEGE', 'Another guild broke this Fort');
  if (!Array.isArray(droidIds) || !droidIds.length) throw new SiegeError('NO_DROIDS', 'Assign at least one droid to hold the Fort');

  // The first player to claim must physically be there.
  const joystick = require('./joystick');
  const pos = joystick.getEffectivePosition(player, playerLat, playerLng);
  const dist = geo.distanceMeters(pos.lat, pos.lng, fort.lat, fort.lng);
  if (dist > forts.BUILD_RADIUS_METERS) {
    throw new SiegeError('TOO_FAR', `You must be within ${forts.BUILD_RADIUS_METERS}m of the Fort to claim it — you're ${Math.round(dist)}m away`);
  }

  const cost = forts.ASSIGN_COST_ON_CAPTURE * droidIds.length;
  if ((player.crystalBalance || 0) < cost) {
    throw new SiegeError('NOT_ENOUGH_CRYSTALS', `Assigning ${droidIds.length} droid(s) costs ${cost.toLocaleString()} crystals`);
  }

  // Old garrison goes home, damage and all. Losing the Fort shouldn't
  // also destroy the droids.
  garrisonDroids(fort).forEach((d) => { d.fortId = null; });
  fort.droidIds = [];

  player.crystalBalance -= cost;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -cost, source: 'fort_capture', createdAt: Date.now() });

  const previousGuildId = fort.guildId;
  fort.guildId = player.guildId;
  // Levelling resets on capture, per the spec. The special take-over
  // upgrade slot survives as the one carried-over slot.
  fort.level = 1;
  fort.upgradeSlots = [{ index: 0, itemId: null, fittedAt: null, takeoverSlot: true }];
  fort.upgradeSlotCount = 1;
  fort.shield = fort.maxShield;
  fort.underAttack = false;
  fort.tokenRewardUntil = Date.now() + forts.TOKEN_REWARD_DAYS * 24 * 60 * 60 * 1000;

  forts.assignDroids(playerId, fortId, droidIds, false);

  siege.status = 'captured';
  sieges.delete(fortId);

  const oldGuild = db.guilds.get(previousGuildId);
  if (oldGuild) {
    realtime.toPlayers(oldGuild.memberIds, 'fort:lost', { fortId, fortName: fort.name, toGuildId: player.guildId });
  }
  return { fort: forts.fortView(fort, player.guildId), capturedFrom: previousGuildId };
}

// ---- views + notifications ----
function notifyDefenders(fort, event, payload) {
  const guild = db.guilds.get(fort.guildId);
  if (guild) realtime.toPlayers(guild.memberIds, event, payload);
}
function notifyAttackers(siege, event, payload) {
  const guild = db.guilds.get(siege.attackerGuildId);
  if (guild) realtime.toPlayers(guild.memberIds, event, payload);
}

function viewSiege(fort, siege, viewerGuildId) {
  const defenders = garrisonDroids(fort).map((d) => {
    const e = workshop.enrichDroid(d);
    return { id: d.id, speciesName: e.speciesName, level: e.level, hp: e.hp, currentHp: e.currentHp, fainted: e.fainted, ownerId: d.playerId };
  });
  const sortie = siege.sortie && siege.sortie.status === 'active' ? {
    playerId: siege.sortie.playerId,
    username: (db.players.get(siege.sortie.playerId) || {}).username,
    turn: siege.sortie.turn,
    team: siege.sortie.teamIds.map((id) => {
      const e = workshop.enrichDroid(db.ownedDroids.get(id));
      return { id, speciesName: e.speciesName, currentHp: e.currentHp, hp: e.hp, fainted: e.fainted };
    }),
    activeIndex: siege.sortie.activeIndex,
  } : null;

  return {
    fortId: fort.id,
    fortName: fort.name,
    phase: siege.phase,
    // The spec's "safe / attack" box states.
    droidBoxState: defenders.some((d) => !d.fainted) ? 'attack' : 'safe',
    shieldBoxState: siege.phase === 'droids' ? 'locked' : (fort.shield > 0 ? 'attack' : 'breached'),
    attackerGuildId: siege.attackerGuildId,
    isAttacker: viewerGuildId === siege.attackerGuildId,
    isDefender: viewerGuildId === fort.guildId,
    defenders,
    defendersStanding: defenders.filter((d) => !d.fainted).length,
    shield: fort.shield,
    maxShield: fort.maxShield,
    shieldPercent: fort.maxShield ? Math.round((fort.shield / fort.maxShield) * 100) : 0,
    sortie,
    sortieInProgress: Boolean(sortie),
    log: siege.log.slice(-15),
    attackCost: ATTACK_COST,
    initiateCost: INITIATE_COST,
    shieldRepairCost: SHIELD_REPAIR_COST,
    reviveCost: DROID_REVIVE_COST,
    startedAt: siege.startedAt,
  };
}

function siegeFor(fortId, viewerGuildId) {
  const fort = forts.forts.get(fortId);
  if (!fort) throw new SiegeError('NO_FORT', 'Fort not found');
  const siege = activeSiegeFor(fortId);
  if (!siege) return { fortId, active: false, fortName: fort.name };
  return { active: true, ...viewSiege(fort, siege, viewerGuildId) };
}

// Every siege this player's guild is involved in, attacking or defending.
function siegesForPlayer(playerId) {
  const player = db.players.get(playerId);
  if (!player || !player.guildId) return { attacking: [], defending: [] };
  const attacking = [];
  const defending = [];
  for (const [fortId, s] of sieges.entries()) {
    if (s.status !== 'active') continue;
    const fort = forts.forts.get(fortId);
    if (!fort) continue;
    const view = viewSiege(fort, s, player.guildId);
    if (s.attackerGuildId === player.guildId) attacking.push(view);
    else if (fort.guildId === player.guildId) defending.push(view);
  }
  return { attacking, defending };
}

module.exports = {
  INITIATE_COST, ATTACK_COST, SHIELD_REPAIR_COST, DROID_REVIVE_COST,
  sieges,
  initiate, startSortie, attack, attackShield,
  reviveDroid, repairShield, capture,
  siegeFor, siegesForPlayer, activeSiegeFor,
  fortDefenceMultipliers,
  SiegeError,
};
