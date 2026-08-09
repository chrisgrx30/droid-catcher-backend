// presence.js
//
// Who's online right now.
//
// HOW IT WORKS
// Every authenticated request touches touch(playerId), which records a
// timestamp. A player counts as online if that timestamp is within
// ONLINE_WINDOW_MS. That's it — no sockets, no connection state to
// leak, and it survives a Render restart gracefully (everyone shows
// offline for a moment, then comes back as they act).
//
// WHY TIMESTAMPS RATHER THAN CONNECTIONS
// The client already polls. A player with the tab open is making
// requests every few seconds, so their timestamp stays fresh without
// any extra traffic. A player who closed the tab stops touching and
// ages out. Connection-based presence would need the socket layer
// discussed for real-time PVP, and would still need this fallback for
// anyone on a flaky mobile connection.
//
// DELIBERATELY NOT PERSISTED
// lastSeenAt is transient state — after a redeploy, "who was online
// three hours ago" is meaningless. Keeping it out of the snapshot also
// keeps the save small. This is the one player field that intentionally
// does NOT go into playerDefaults.

const ONLINE_WINDOW_MS = 90 * 1000;   // seen within 90s = online
const IDLE_WINDOW_MS = 10 * 60 * 1000; // seen within 10min = idle

// playerId -> epoch ms
const lastSeen = new Map();

function touch(playerId) {
  if (!playerId) return;
  lastSeen.set(Number(playerId), Date.now());
}

function statusOf(playerId, now = Date.now()) {
  const seen = lastSeen.get(Number(playerId));
  if (!seen) return 'offline';
  const age = now - seen;
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age <= IDLE_WINDOW_MS) return 'idle';
  return 'offline';
}

function isOnline(playerId) {
  return statusOf(playerId) === 'online';
}

function lastSeenAt(playerId) {
  return lastSeen.get(Number(playerId)) || null;
}

// Human-readable "last seen" for the offline case.
function lastSeenText(playerId, now = Date.now()) {
  const seen = lastSeen.get(Number(playerId));
  if (!seen) return 'Offline';
  const mins = Math.floor((now - seen) / 60000);
  if (mins < 1) return 'Online now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Decorates any list of objects carrying an `id` with presence fields.
// Used by the friends list, guild roster, and anywhere else players are
// listed — one call, consistent shape everywhere.
function decorate(list, now = Date.now()) {
  return (list || []).map((entry) => ({
    ...entry,
    presence: statusOf(entry.id, now),
    online: statusOf(entry.id, now) === 'online',
    lastSeenText: lastSeenText(entry.id, now),
  }));
}

function onlineCount(playerIds, now = Date.now()) {
  return (playerIds || []).filter((id) => statusOf(id, now) === 'online').length;
}

// Housekeeping so the map can't grow forever on a long-running server.
function prune(now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [id, seen] of lastSeen.entries()) {
    if (seen < cutoff) lastSeen.delete(id);
  }
}

module.exports = {
  ONLINE_WINDOW_MS,
  IDLE_WINDOW_MS,
  touch,
  statusOf,
  isOnline,
  lastSeenAt,
  lastSeenText,
  decorate,
  onlineCount,
  prune,
  _lastSeen: lastSeen,
};
