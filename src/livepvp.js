// livepvp.js
//
// LIVE PVP — real-time battles, separate from the existing async PVP.
//
// WHY A SEPARATE SYSTEM
// The existing PVP in battle.js is asynchronous: a challenge sits there
// until the other player gets round to it, and turns can be hours
// apart. That works and people are using it. Live PVP has completely
// different rules — both players must be online, turns are timed, and
// walking away forfeits.
//
// Building this as its own module with its own rooms means the beta can
// run alongside the existing system without risking it. If live PVP
// turns out to be a bad fit, deleting this file and its routes removes
// it cleanly.
//
// THE PROBLEM REAL-TIME CREATES
// Async PVP has no concept of someone abandoning a match — the battle
// just sits there. The moment turns are timed, one player closing their
// tab leaves the other staring at a screen forever. So:
//
//   - Every turn has a countdown (TURN_SECONDS).
//   - Running out doesn't stall the match; the server plays that turn
//     automatically. The battle keeps moving.
//   - Miss MAX_MISSED_TURNS in a row and you forfeit.
//
// Auto-play rather than instant forfeit is deliberate: a player who
// loses signal for twenty seconds shouldn't lose the match, but a
// player who left shouldn't hold the other hostage either.
//
// RENDER FREE TIER CAVEAT
// The instance spins down when idle, which drops every open SSE stream.
// Clients reconnect automatically, and because all battle state lives
// here on the server rather than in the stream, a reconnect resumes
// exactly where it left off. A match in progress during a spin-down
// will stall until someone makes a request that wakes the instance —
// worth knowing before promising players seamless live battles.

const db = require('./db');
const battle = require('./battle');
const workshop = require('./workshop');
const realtime = require('./realtime');
const presence = require('./presence');
const levels = require('./levels');

// ---- tuning ----
const TURN_SECONDS = 30;
const MAX_MISSED_TURNS = 3;        // consecutive; then forfeit
const CHALLENGE_EXPIRY_MS = 60 * 1000;  // an unanswered challenge dies after a minute
const ROOM_IDLE_CLEANUP_MS = 30 * 60 * 1000;
const TICK_MS = 1000;

// Reward for winning a live match. Modest on purpose — this is a beta
// mode, and it shouldn't become the optimal way to farm anything.
const WIN_REWARD = { crystals: 500 };

const rooms = new Map();      // roomId -> room
const challenges = new Map(); // challengeId -> challenge

class LivePvpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- challenges ----

function challenge(fromPlayerId, toPlayerId, teamDroidIds) {
  const from = db.players.get(fromPlayerId);
  const to = db.players.get(toPlayerId);
  if (!from) throw new LivePvpError('NO_PLAYER', 'Player not found');
  if (!to) throw new LivePvpError('NO_OPPONENT', 'Opponent not found');
  if (fromPlayerId === toPlayerId) throw new LivePvpError('SELF', 'You cannot challenge yourself');

  // Live means live — an offline opponent can't take timed turns.
  if (!presence.isOnline(toPlayerId)) {
    throw new LivePvpError('OPPONENT_OFFLINE', `${to.username} isn't online right now`);
  }
  if (activeRoomFor(fromPlayerId)) throw new LivePvpError('ALREADY_IN_BATTLE', "You're already in a live battle");
  if (activeRoomFor(toPlayerId)) throw new LivePvpError('OPPONENT_BUSY', `${to.username} is already in a live battle`);

  const team = battle.validateTeam(fromPlayerId, teamDroidIds);

  const ch = {
    id: db.nextId(),
    fromPlayerId,
    toPlayerId,
    fromUsername: from.username,
    teamDroidIds: team.map((d) => d.id),
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
  };
  challenges.set(ch.id, ch);

  realtime.toPlayer(toPlayerId, 'live:challenge', {
    challengeId: ch.id,
    fromPlayerId,
    fromUsername: from.username,
    expiresAt: ch.expiresAt,
    secondsToRespond: Math.round(CHALLENGE_EXPIRY_MS / 1000),
  });

  return ch;
}

function declineChallenge(challengeId, playerId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new LivePvpError('NO_CHALLENGE', 'Challenge not found');
  if (ch.toPlayerId !== playerId) throw new LivePvpError('NOT_YOURS', 'Not your challenge');
  challenges.delete(challengeId);
  realtime.toPlayer(ch.fromPlayerId, 'live:declined', { challengeId, byPlayerId: playerId });
  return { declined: true };
}

function acceptChallenge(challengeId, playerId, teamDroidIds) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new LivePvpError('NO_CHALLENGE', 'Challenge not found or expired');
  if (ch.toPlayerId !== playerId) throw new LivePvpError('NOT_YOURS', 'Not your challenge');
  if (Date.now() > ch.expiresAt) {
    challenges.delete(challengeId);
    throw new LivePvpError('EXPIRED', 'That challenge expired');
  }

  const challengerTeam = battle.validateTeam(ch.fromPlayerId, ch.teamDroidIds);
  const accepterTeam = battle.validateTeam(playerId, teamDroidIds);
  challenges.delete(challengeId);

  const room = {
    id: db.nextId(),
    status: 'active',
    playerIds: [ch.fromPlayerId, playerId],
    usernames: {
      [ch.fromPlayerId]: ch.fromUsername,
      [playerId]: db.players.get(playerId).username,
    },
    teams: {
      [ch.fromPlayerId]: challengerTeam.map((d) => d.id),
      [playerId]: accepterTeam.map((d) => d.id),
    },
    activeIndex: {
      [ch.fromPlayerId]: battle.firstNonFaintedIndex(challengerTeam),
      [playerId]: battle.firstNonFaintedIndex(accepterTeam),
    },
    missedTurns: { [ch.fromPlayerId]: 0, [playerId]: 0 },
    turnPlayerId: ch.fromPlayerId, // challenger moves first
    turnEndsAt: Date.now() + TURN_SECONDS * 1000,
    turnNumber: 1,
    log: [],
    winnerId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(room.id, room);

  realtime.toPlayers(room.playerIds, 'live:start', viewFor(room));
  return room;
}

// ---- battle ----

function activeRoomFor(playerId) {
  for (const room of rooms.values()) {
    if (room.status === 'active' && room.playerIds.includes(playerId)) return room;
  }
  return null;
}

function opponentOf(room, playerId) {
  return room.playerIds.find((id) => id !== playerId);
}

function enrichTeam(room, playerId) {
  return room.teams[playerId].map((id) => workshop.enrichDroid(db.ownedDroids.get(id)));
}

function viewFor(room) {
  const view = {
    roomId: room.id,
    status: room.status,
    playerIds: room.playerIds,
    usernames: room.usernames,
    turnPlayerId: room.turnPlayerId,
    turnEndsAt: room.turnEndsAt,
    secondsLeft: room.status === 'active' ? Math.max(0, Math.ceil((room.turnEndsAt - Date.now()) / 1000)) : 0,
    turnNumber: room.turnNumber,
    turnSeconds: TURN_SECONDS,
    missedTurns: room.missedTurns,
    maxMissedTurns: MAX_MISSED_TURNS,
    winnerId: room.winnerId,
    log: room.log.slice(-12),
    teams: {},
    activeIndex: room.activeIndex,
  };
  room.playerIds.forEach((pid) => { view.teams[pid] = enrichTeam(room, pid); });
  return view;
}

// The single place a turn resolves, whether the player pressed the
// button or the timer played it for them.
function resolveAttack(room, playerId, wasAuto) {
  const oppId = opponentOf(room, playerId);
  const myTeam = room.teams[playerId].map((id) => db.ownedDroids.get(id));
  const oppTeam = room.teams[oppId].map((id) => db.ownedDroids.get(id));
  const attacker = myTeam[room.activeIndex[playerId]];
  const defender = oppTeam[room.activeIndex[oppId]];

  const atkStats = workshop.enrichDroid(attacker);
  const companion = workshop.companionBuffMultiplier(playerId, 'damage');
  const variance = 1 + (Math.random() * 2 - 1) * battle.DAMAGE_VARIANCE;
  const damage = Math.max(1, Math.round(atkStats.attack * companion * variance));

  defender.currentHpDamage = (defender.currentHpDamage || 0) + damage;
  const defenderStats = workshop.enrichDroid(defender);
  const fainted = defenderStats.fainted;

  const entry = {
    turn: room.turnNumber,
    attackerPlayerId: playerId,
    attackerName: atkStats.speciesName,
    defenderName: defenderStats.speciesName,
    damage,
    defenderFainted: fainted,
    defenderHpLeft: Math.max(0, defenderStats.currentHp),
    auto: Boolean(wasAuto),
    at: Date.now(),
  };
  room.log.push(entry);

  if (fainted) {
    const next = battle.firstNonFaintedIndex(oppTeam);
    if (next === -1) return finish(room, playerId, entry, 'knockout');
    room.activeIndex[oppId] = next;
  }

  // Hand over
  room.turnPlayerId = oppId;
  room.turnNumber += 1;
  room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  room.updatedAt = Date.now();

  realtime.toPlayers(room.playerIds, 'live:turn', { ...viewFor(room), lastAction: entry });
  return { room, entry };
}

function attack(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) throw new LivePvpError('NO_ROOM', 'Battle not found');
  if (room.status !== 'active') throw new LivePvpError('ENDED', 'This battle has ended');
  if (!room.playerIds.includes(playerId)) throw new LivePvpError('NOT_IN_BATTLE', 'You are not in this battle');
  if (room.turnPlayerId !== playerId) throw new LivePvpError('NOT_YOUR_TURN', "It's not your turn");

  // Acting resets the missed-turn counter — a player who reconnects and
  // plays is back in good standing.
  room.missedTurns[playerId] = 0;
  return resolveAttack(room, playerId, false);
}

function forfeit(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) throw new LivePvpError('NO_ROOM', 'Battle not found');
  if (room.status !== 'active') throw new LivePvpError('ENDED', 'This battle has ended');
  if (!room.playerIds.includes(playerId)) throw new LivePvpError('NOT_IN_BATTLE', 'You are not in this battle');
  return finish(room, opponentOf(room, playerId), null, 'forfeit');
}

function finish(room, winnerId, lastEntry, reason) {
  room.status = 'finished';
  room.winnerId = winnerId;
  room.finishedAt = Date.now();
  room.endReason = reason;

  const winner = db.players.get(winnerId);
  if (winner && WIN_REWARD.crystals) {
    winner.crystalBalance = (winner.crystalBalance || 0) + WIN_REWARD.crystals;
    db.crystalTransactions.push({
      id: db.nextId(), playerId: winnerId, amount: WIN_REWARD.crystals,
      source: 'live_pvp_win', createdAt: Date.now(),
    });
    levels.awardXp(winnerId, 'battleWin');
  }

  const payload = { ...viewFor(room), lastAction: lastEntry, reason, reward: WIN_REWARD };
  realtime.toPlayers(room.playerIds, 'live:end', payload);
  return { room, entry: lastEntry, finished: true };
}

// ---- the tick ----
// One interval drives every room's countdown. Cheap: rooms are few and
// short-lived, and finished ones are skipped.
let ticker = null;

function tick() {
  const now = Date.now();

  for (const [id, ch] of challenges.entries()) {
    if (now > ch.expiresAt) {
      challenges.delete(id);
      realtime.toPlayer(ch.fromPlayerId, 'live:expired', { challengeId: id });
      realtime.toPlayer(ch.toPlayerId, 'live:expired', { challengeId: id });
    }
  }

  for (const [id, room] of rooms.entries()) {
    if (room.status !== 'active') {
      if (now - (room.finishedAt || room.updatedAt) > ROOM_IDLE_CLEANUP_MS) rooms.delete(id);
      continue;
    }
    if (now < room.turnEndsAt) continue;

    // Timer ran out.
    const late = room.turnPlayerId;
    room.missedTurns[late] = (room.missedTurns[late] || 0) + 1;

    if (room.missedTurns[late] >= MAX_MISSED_TURNS) {
      realtime.toPlayers(room.playerIds, 'live:timeout', {
        roomId: room.id, playerId: late, missed: room.missedTurns[late], forfeited: true,
      });
      finish(room, opponentOf(room, late), null, 'timeout');
      continue;
    }

    // Play their turn for them so the match keeps moving.
    realtime.toPlayers(room.playerIds, 'live:timeout', {
      roomId: room.id, playerId: late, missed: room.missedTurns[late], forfeited: false,
    });
    try {
      resolveAttack(room, late, true);
    } catch (e) {
      finish(room, opponentOf(room, late), null, 'error');
    }
  }
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(tick, TICK_MS);
  if (ticker.unref) ticker.unref(); // don't hold the process open in tests
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

// ---- lobby ----
// Who can you actually challenge right now: online friends and guildmates.
function lobbyFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new LivePvpError('NO_PLAYER', 'Player not found');

  const candidateIds = new Set();
  (player.friends || []).forEach((id) => candidateIds.add(id));
  if (player.guildId) {
    const guild = db.guilds.get(player.guildId);
    if (guild) guild.memberIds.forEach((id) => { if (id !== playerId) candidateIds.add(id); });
  }

  const opponents = [...candidateIds].map((id) => {
    const other = db.players.get(id);
    if (!other) return null;
    return {
      id,
      username: other.username,
      presence: presence.statusOf(id),
      online: presence.isOnline(id),
      streaming: realtime.isConnected(id),
      inBattle: Boolean(activeRoomFor(id)),
    };
  }).filter(Boolean)
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

  const incoming = [...challenges.values()]
    .filter((c) => c.toPlayerId === playerId)
    .map((c) => ({ challengeId: c.id, fromPlayerId: c.fromPlayerId, fromUsername: c.fromUsername, expiresAt: c.expiresAt }));

  const outgoing = [...challenges.values()]
    .filter((c) => c.fromPlayerId === playerId)
    .map((c) => ({ challengeId: c.id, toPlayerId: c.toPlayerId, expiresAt: c.expiresAt }));

  const current = activeRoomFor(playerId);

  return {
    opponents,
    incoming,
    outgoing,
    currentBattle: current ? viewFor(current) : null,
    turnSeconds: TURN_SECONDS,
    maxMissedTurns: MAX_MISSED_TURNS,
    winReward: WIN_REWARD,
    connected: realtime.isConnected(playerId),
  };
}

function roomView(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) throw new LivePvpError('NO_ROOM', 'Battle not found');
  if (!room.playerIds.includes(playerId)) throw new LivePvpError('NOT_IN_BATTLE', 'You are not in this battle');
  return viewFor(room);
}

module.exports = {
  TURN_SECONDS,
  MAX_MISSED_TURNS,
  CHALLENGE_EXPIRY_MS,
  WIN_REWARD,
  challenge,
  acceptChallenge,
  declineChallenge,
  attack,
  forfeit,
  lobbyFor,
  roomView,
  activeRoomFor,
  startTicker,
  stopTicker,
  tick,
  rooms,
  challenges,
  LivePvpError,
};
