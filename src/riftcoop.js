// ---- Co-op Space Rift ----
// Two players, one map, one mission. Built as a thin layer OVER rift.js
// rather than a fork of it, so map generation, encounters, capture rules
// and loot maths stay in exactly one place.
//
// Confirmed rules:
//   · same seed  → both players explore an identical world
//   · chests are consumed — first to open it gets it, it's gone for both
//   · bosses can be fought together or solo
//   · captures use each player's OWN Rift Cells
//
// The shared mission lives here; each player's riftMission points at it
// by party id, so rift.js's existing functions keep working unchanged.

const db = require('./db');
const rift = require('./rift');
const workshop = require('./workshop');
const realtime = require('./realtime');

class CoopError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const MAX_PLAYERS = 2;
const INVITE_TTL_MS = 5 * 60 * 1000;   // an unanswered invite expires

const parties = new Map();   // partyId -> party
const invites = new Map();   // inviteId -> invite

function partyOf(playerId) {
  for (const p of parties.values()) {
    if (p.status !== 'ended' && p.members.some((m) => m.playerId === playerId)) return p;
  }
  return null;
}

// ---- invites ----
function invite(fromPlayerId, toPlayerId) {
  const from = db.players.get(fromPlayerId);
  const to = db.players.get(toPlayerId);
  if (!from) throw new CoopError('NO_PLAYER', 'Player not found');
  if (!to) throw new CoopError('NO_TARGET', 'That player does not exist');
  if (fromPlayerId === toPlayerId) throw new CoopError('SELF', 'You cannot invite yourself');
  if (rift.activeMission(from)) throw new CoopError('IN_MISSION', 'Finish your current Rift run first');
  if (rift.activeMission(to)) throw new CoopError('TARGET_BUSY', `${to.username} is already in a Rift`);
  if (partyOf(fromPlayerId)) throw new CoopError('IN_PARTY', 'You are already in a co-op party');
  if (partyOf(toPlayerId)) throw new CoopError('TARGET_IN_PARTY', `${to.username} is already in a party`);

  const inv = {
    id: db.nextId(),
    fromPlayerId, fromName: from.username,
    toPlayerId, toName: to.username,
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_TTL_MS,
    status: 'pending',
  };
  invites.set(inv.id, inv);
  realtime.toPlayer(toPlayerId, 'coop:invite', {
    inviteId: inv.id, fromPlayerId, fromName: from.username, expiresAt: inv.expiresAt,
  });
  return inv;
}

function invitesFor(playerId) {
  const now = Date.now();
  return [...invites.values()].filter(
    (i) => i.toPlayerId === playerId && i.status === 'pending' && now < i.expiresAt
  );
}

function declineInvite(inviteId, playerId) {
  const inv = invites.get(inviteId);
  if (!inv) throw new CoopError('NO_INVITE', 'That invite no longer exists');
  if (inv.toPlayerId !== playerId) throw new CoopError('NOT_YOURS', 'That invite is not for you');
  inv.status = 'declined';
  realtime.toPlayer(inv.fromPlayerId, 'coop:declined', { by: inv.toName });
  return { declined: true };
}

// ---- party formation ----
function acceptInvite(inviteId, playerId) {
  const inv = invites.get(inviteId);
  if (!inv) throw new CoopError('NO_INVITE', 'That invite no longer exists');
  if (inv.toPlayerId !== playerId) throw new CoopError('NOT_YOURS', 'That invite is not for you');
  if (inv.status !== 'pending') throw new CoopError('RESOLVED', 'That invite has already been answered');
  if (Date.now() > inv.expiresAt) throw new CoopError('EXPIRED', 'That invite has expired');

  inv.status = 'accepted';
  const party = {
    id: db.nextId(),
    status: 'forming',          // forming -> active -> ended
    createdAt: Date.now(),
    leaderId: inv.fromPlayerId,
    members: [
      { playerId: inv.fromPlayerId, username: inv.fromName, ready: false, teamIds: [] },
      { playerId: inv.toPlayerId, username: inv.toName, ready: false, teamIds: [] },
    ],
    mission: null,
  };
  parties.set(party.id, party);

  realtime.toPlayers(party.members.map((m) => m.playerId), 'coop:formed', {
    partyId: party.id, members: party.members.map((m) => m.username),
  });
  return viewFor(playerId);
}

// Each player picks their own six droids.
function setTeam(playerId, teamDroidIds) {
  const party = partyOf(playerId);
  if (!party) throw new CoopError('NO_PARTY', 'You are not in a co-op party');
  if (party.status !== 'forming') throw new CoopError('ALREADY_STARTED', 'The mission has already started');
  if (!Array.isArray(teamDroidIds) || teamDroidIds.length !== rift.TEAM_SIZE) {
    throw new CoopError('BAD_TEAM', `Take exactly ${rift.TEAM_SIZE} droids into the Rift`);
  }
  // Same eligibility rules as a solo run.
  teamDroidIds.forEach((id) => {
    const d = db.ownedDroids.get(id);
    if (!d || d.playerId !== playerId) throw new CoopError('NO_DROID', 'One of those droids is not yours');
    if (d.fortId) throw new CoopError('IN_FORT', 'A garrisoned droid cannot enter the Rift');
    if (d.smugglerRun) throw new CoopError('ON_RUN', "That droid is out on a Smuggler's Run");
    if (workshop.enrichDroid(d).fainted) throw new CoopError('FAINTED', 'One of those droids is fainted');
  });

  const me = party.members.find((m) => m.playerId === playerId);
  me.teamIds = [...teamDroidIds];
  me.ready = true;

  realtime.toPlayers(party.members.map((m) => m.playerId), 'coop:ready', {
    partyId: party.id, playerId, ready: true,
  });
  return viewFor(playerId);
}

// ---- launching ----
// One seed, one map, one mission object — that's what makes both players
// genuinely explore the same world rather than two identical copies.
function launch(playerId) {
  const party = partyOf(playerId);
  if (!party) throw new CoopError('NO_PARTY', 'You are not in a co-op party');
  if (party.leaderId !== playerId) throw new CoopError('NOT_LEADER', 'Only the party leader can launch');
  if (party.status !== 'forming') throw new CoopError('ALREADY_STARTED', 'Already started');
  if (!party.members.every((m) => m.ready)) throw new CoopError('NOT_READY', 'Both players must pick a team first');

  // Entry cost is charged per player, same as solo.
  const entry = db.modeCost('rift', 'riftCubes', 1);
  party.members.forEach((m) => {
    const p = db.players.get(m.playerId);
    if (entry.quantity > 0 && (p[entry.itemKey] || 0) < entry.quantity) {
      throw new CoopError('NO_RIFT_CUBE', `${m.username} needs ${entry.quantity} ${entry.itemKey} to enter`);
    }
  });
  party.members.forEach((m) => {
    const p = db.players.get(m.playerId);
    if (entry.quantity > 0) p[entry.itemKey] -= entry.quantity;
  });

  const seed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const map = rift.buildMap(seed);

  // ONE mission object, shared. Positions and teams are per-player;
  // everything else (opened chests, bosses, loot) is genuinely shared.
  const mission = {
    coop: true,
    partyId: party.id,
    playerId: party.leaderId,      // rift.js helpers expect this
    seed,
    status: 'active',
    startedAt: Date.now(),
    x: map.start.x,
    y: map.start.y,
    positions: {},                 // playerId -> {x,y}
    teams: {},                     // playerId -> per-player droid state
    opened: [],                    // SHARED — first to open it wins
    bossesDefeated: [],            // SHARED
    healingUses: 0,                // SHARED pool
    steps: 0,
    loot: { crystals: 0, materials: {} },   // SHARED
    captured: [],
    encounters: {},                // playerId -> their current encounter
    flags: [],
    flagsLeft: 10,
    team: [],
  };

  party.members.forEach((m) => {
    mission.positions[m.playerId] = { x: map.start.x, y: map.start.y };
    mission.teams[m.playerId] = m.teamIds.map((id) => {
      const d = db.ownedDroids.get(id);
      const e = workshop.enrichDroid(d);
      return { droidId: d.id, name: e.speciesName, hp: e.currentHp, maxHp: e.hp, attack: e.attack, rarity: e.rarity };
    });
    // Point the player at the shared mission so existing views work.
    const p = db.players.get(m.playerId);
    p.riftMission = mission;
    p.coopPartyId = party.id;
  });

  party.mission = mission;
  party.status = 'active';

  realtime.toPlayers(party.members.map((m) => m.playerId), 'coop:launched', {
    partyId: party.id, seed,
  });
  return viewFor(playerId);
}

// ---- movement ----
// Each player moves independently; both see the other move in real time.
function move(playerId, dir) {
  const party = partyOf(playerId);
  if (!party || party.status !== 'active') throw new CoopError('NO_MISSION', 'No co-op mission in progress');
  const m = party.mission;
  const map = rift.buildMap(m.seed);
  const pos = m.positions[playerId];
  if (!pos) throw new CoopError('NOT_IN_PARTY', 'You are not in this party');
  if (m.encounters[playerId]) throw new CoopError('IN_ENCOUNTER', 'Finish your encounter first');

  const deltas = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const d = deltas[dir];
  if (!d) throw new CoopError('BAD_DIR', 'Unknown direction');

  const nx = pos.x + d[0];
  const ny = pos.y + d[1];
  if (nx < 0 || ny < 0 || nx >= rift.MAP_W || ny >= rift.MAP_H) {
    throw new CoopError('EDGE', 'The Rift boundary blocks you');
  }
  if (map.grid[ny] && map.grid[ny][nx] === '#') throw new CoopError('BLOCKED', 'A wall blocks the way');

  pos.x = nx; pos.y = ny;
  m.steps += 1;

  realtime.toPlayers(party.members.map((x) => x.playerId), 'coop:move', {
    partyId: party.id, playerId, x: nx, y: ny,
  });

  // Wild encounters are per-player — you meet your own droids.
  if (Math.random() < 0.055) {
    const pool = rift.RIFT_DROIDS.filter((r) => r.rarity === 'common' || r.rarity === 'uncommon');
    const def = pool[Math.floor(Math.random() * pool.length)];
    m.encounters[playerId] = {
      kind: 'wild', defId: def.id, name: def.name, rarity: def.rarity,
      hp: def.hp, maxHp: def.hp, attack: def.attack, move: def.move,
      canRun: true, captureOffered: false, activeIndex: 0, log: [],
    };
  }
  return viewFor(playerId);
}

// ---- shared pickups ----
// First player to reach a chest takes it; it's consumed for both.
function investigate(playerId) {
  const party = partyOf(playerId);
  if (!party || party.status !== 'active') throw new CoopError('NO_MISSION', 'No co-op mission in progress');
  const m = party.mission;
  const map = rift.buildMap(m.seed);
  const pos = m.positions[playerId];
  const me = party.members.find((x) => x.playerId === playerId);

  const at = (list) => list.find((o) => o.x === pos.x && o.y === pos.y && !m.opened.includes(o.id));

  const chest = at(map.chests);
  if (chest) {
    m.opened.push(chest.id);
    const crystals = 1500 + Math.floor(Math.random() * 3500);
    const mats = ['novaChips', 'paint', 'repairKits', 'augmentCores'];
    const mat = mats[Math.floor(Math.random() * mats.length)];
    const amount = 1 + Math.floor(Math.random() * 3);
    m.loot.crystals += crystals;
    m.loot.materials[mat] = (m.loot.materials[mat] || 0) + amount;
    realtime.toPlayers(party.members.map((x) => x.playerId), 'coop:pickup', {
      partyId: party.id, playerId, username: me.username,
      kind: 'chest', crystals, material: mat, amount,
    });
    return { ...viewFor(playerId), found: { kind: 'chest', crystals, material: mat, amount } };
  }

  const cr = at(map.crystals);
  if (cr) {
    m.opened.push(cr.id);
    const crystals = 400 + Math.floor(Math.random() * 900);
    m.loot.crystals += crystals;
    realtime.toPlayers(party.members.map((x) => x.playerId), 'coop:pickup', {
      partyId: party.id, playerId, username: me.username, kind: 'crystal', crystals,
    });
    return { ...viewFor(playerId), found: { kind: 'crystal', crystals } };
  }

  const heal = map.healing.find((o) => o.x === pos.x && o.y === pos.y);
  if (heal && m.healingUses < rift.MAX_HEALING_USES) {
    // Shared pool — using one costs the party, not just you.
    m.healingUses += 1;
    (m.teams[playerId] || []).forEach((t) => { t.hp = t.maxHp; });
    realtime.toPlayers(party.members.map((x) => x.playerId), 'coop:heal', {
      partyId: party.id, playerId, username: me.username,
      usesLeft: rift.MAX_HEALING_USES - m.healingUses,
    });
    return { ...viewFor(playerId), found: { kind: 'heal', usesLeft: rift.MAX_HEALING_USES - m.healingUses } };
  }

  if (pos.x === map.exit.x && pos.y === map.exit.y) {
    return finish(party, playerId);
  }
  throw new CoopError('NOTHING_HERE', 'Nothing to investigate here');
}

// ---- extraction ----
// Loot is shared, so both players bank the same haul.
function finish(party, byPlayerId) {
  const m = party.mission;
  if (m.bossesDefeated.length < rift.REQUIRED_BOSSES) {
    throw new CoopError('BOSSES_REMAIN',
      `The escape pod is sealed — defeat all ${rift.REQUIRED_BOSSES} Rift Bosses first (${m.bossesDefeated.length}/${rift.REQUIRED_BOSSES})`);
  }
  party.status = 'ended';
  m.status = 'complete';

  const summary = { crystals: m.loot.crystals, materials: { ...m.loot.materials }, steps: m.steps };

  party.members.forEach((mem) => {
    const p = db.players.get(mem.playerId);
    if (!p) return;
    p.crystalBalance = (p.crystalBalance || 0) + m.loot.crystals;
    db.crystalTransactions.push({
      id: db.nextId(), playerId: mem.playerId, amount: m.loot.crystals,
      source: 'coop_rift', createdAt: Date.now(),
    });
    Object.entries(m.loot.materials).forEach(([k, v]) => { p[k] = (p[k] || 0) + v; });
    p.riftMission = null;
    p.coopPartyId = null;
    // Droid Memory — both players' droids record the run.
    (mem.teamIds || []).forEach((id) => {
      const d = db.ownedDroids.get(id);
      if (!d) return;
      try {
        require('./memory').bumpMany(d, {
          riftMissions: 1, missionsCompleted: 1,
          bossesDefeated: m.bossesDefeated.length,
        });
      } catch (e) {}
    });
  });

  realtime.toPlayers(party.members.map((x) => x.playerId), 'coop:finished', {
    partyId: party.id, summary, extractedBy: byPlayerId,
  });
  return { finished: true, summary };
}

function abandon(playerId) {
  const party = partyOf(playerId);
  if (!party) throw new CoopError('NO_PARTY', 'You are not in a co-op party');
  party.status = 'ended';
  party.members.forEach((m) => {
    const p = db.players.get(m.playerId);
    if (p) { p.riftMission = null; p.coopPartyId = null; }
  });
  realtime.toPlayers(party.members.map((m) => m.playerId), 'coop:abandoned', {
    partyId: party.id, by: playerId,
  });
  return { abandoned: true };
}

// ---- view ----
function viewFor(playerId) {
  const party = partyOf(playerId);
  if (!party) return { inParty: false, invites: invitesFor(playerId) };

  const base = {
    inParty: true,
    partyId: party.id,
    status: party.status,
    isLeader: party.leaderId === playerId,
    members: party.members.map((m) => ({
      playerId: m.playerId, username: m.username, ready: m.ready,
      isYou: m.playerId === playerId,
    })),
  };
  if (party.status !== 'active' || !party.mission) return base;

  const m = party.mission;
  const map = rift.buildMap(m.seed);
  return {
    ...base,
    seed: m.seed,
    steps: m.steps,
    // Both players' positions, so each can see the other on the map.
    positions: Object.entries(m.positions).map(([pid, pos]) => ({
      playerId: Number(pid),
      username: (party.members.find((x) => x.playerId === Number(pid)) || {}).username,
      x: pos.x, y: pos.y,
      isYou: Number(pid) === playerId,
    })),
    myPosition: m.positions[playerId],
    myTeam: m.teams[playerId] || [],
    encounter: m.encounters[playerId] || null,
    bossesDefeated: m.bossesDefeated.length,
    totalBosses: rift.REQUIRED_BOSSES,
    healingUses: m.healingUses,
    maxHealing: rift.MAX_HEALING_USES,
    chestsOpened: m.opened.filter((i) => String(i).startsWith('chest')).length,
    totalChests: map.chests.length,
    loot: m.loot,
    exitPos: map.exit,
    // Cell counts — captures use each player's OWN cells.
    cells: (() => {
      const p = db.players.get(playerId) || {};
      return { riftCells: p.riftCells || 0, ultraRiftCells: p.ultraRiftCells || 0 };
    })(),
  };
}

module.exports = {
  CoopError,
  MAX_PLAYERS,
  parties,
  invites,
  partyOf,
  invite,
  invitesFor,
  acceptInvite,
  declineInvite,
  setTeam,
  launch,
  move,
  investigate,
  abandon,
  viewFor,
};
