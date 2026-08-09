// realtime.js
//
// Server-Sent Events hub — the push channel for live PVP, chat and
// notifications.
//
// WHY SSE AND NOT WEBSOCKETS
// This backend has zero npm dependencies by design. SSE is built into
// Node's http module and every browser, so it stays that way;
// WebSockets would mean adding `ws` as a first dependency. Nothing here
// needs a bidirectional socket — the client keeps POSTing its actions
// normally and only needs to RECEIVE pushes. SSE also reconnects on its
// own, which matters on mobile networks and on Render's free tier where
// the instance spins down when idle.
//
// WHAT A CONNECTION IS
// One long-lived GET /stream?playerId=N per player. We hold the `res`
// object open and write `data:` frames to it. A player with two tabs
// open gets two connections — both are kept and both receive, so
// nothing breaks if someone reloads without the old socket closing
// cleanly.
//
// KEEPING IT ALIVE
// Proxies (including Render's) close idle connections. A comment frame
// every 20s keeps them open, and doubles as dead-connection detection:
// when the write throws, the client is gone.

const presence = require('./presence');

const HEARTBEAT_MS = 20 * 1000;
// Guard against a runaway client opening connections in a loop.
const MAX_CONNECTIONS_PER_PLAYER = 4;

// playerId -> Set of { res, id }
const connections = new Map();
let connectionSeq = 1;

function subscribe(playerId, res) {
  const id = Number(playerId);
  if (!id) return null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    // Tells nginx-style proxies not to buffer, which would otherwise
    // hold frames back until the response "finished" — i.e. never.
    'X-Accel-Buffering': 'no',
  });

  if (!connections.has(id)) connections.set(id, new Set());
  const set = connections.get(id);

  // Drop the oldest if a client has gone haywire opening streams.
  while (set.size >= MAX_CONNECTIONS_PER_PLAYER) {
    const oldest = set.values().next().value;
    try { oldest.res.end(); } catch (e) {}
    set.delete(oldest);
  }

  const conn = { res, id: connectionSeq++ };
  set.add(conn);
  presence.touch(id);

  // Tell the client the stream is live, and set its retry interval.
  res.write('retry: 3000\n\n');
  send(res, 'connected', { playerId: id, at: Date.now() });

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
      // An open stream is proof the player is still there — this is
      // what keeps presence accurate for someone sitting on a battle
      // screen making no other requests.
      presence.touch(id);
    } catch (e) {
      cleanup();
    }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    const s = connections.get(id);
    if (s) {
      s.delete(conn);
      if (!s.size) connections.delete(id);
    }
  };

  res.on('close', cleanup);
  res.on('error', cleanup);
  return conn;
}

function send(res, event, payload) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (e) {
    return false;
  }
}

// Push to one player, across all their open tabs.
function toPlayer(playerId, event, payload) {
  const set = connections.get(Number(playerId));
  if (!set || !set.size) return 0;
  let delivered = 0;
  for (const conn of [...set]) {
    if (send(conn.res, event, payload)) delivered++;
    else set.delete(conn);
  }
  return delivered;
}

function toPlayers(playerIds, event, payload) {
  let total = 0;
  (playerIds || []).forEach((id) => { total += toPlayer(id, event, payload); });
  return total;
}

function broadcast(event, payload) {
  let total = 0;
  for (const id of connections.keys()) total += toPlayer(id, event, payload);
  return total;
}

function isConnected(playerId) {
  const set = connections.get(Number(playerId));
  return Boolean(set && set.size);
}

function stats() {
  let total = 0;
  connections.forEach((set) => { total += set.size; });
  return { players: connections.size, connections: total };
}

module.exports = {
  subscribe,
  toPlayer,
  toPlayers,
  broadcast,
  isConnected,
  stats,
  HEARTBEAT_MS,
};
