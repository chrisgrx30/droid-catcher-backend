// admin.js
//
// Admin login, a permanent activity log, and the gift system.
//
// WHAT CHANGED AND WHY
// Before this, admin access was a shared code typed into a prompt, with
// no record of who used it. Anyone with the code was anonymous, and
// there was no way to answer "who created that event?" or "where did
// this player's 50,000 crystals come from?".
//
// Now every admin action records the player ID and username that
// performed it, alongside what they did. The code still gates access —
// this isn't real authentication and shouldn't be mistaken for it — but
// actions are now attributable, which is the part that actually matters
// for a closed beta.
//
// THE LOG IS PERSISTED
// Unlike presence (deliberately transient), the admin log goes into the
// snapshot. A log that vanished on every Render redeploy would be
// worthless. It's capped so it can't grow without bound.

const db = require('./db');

const MAX_LOG_ENTRIES = 2000;

// The log itself. Exported so persistence.js can snapshot it.
const adminLog = [];

// Players who have successfully authenticated at least once. Used to
// show a roster of who has admin access.
const adminUsers = new Map(); // playerId -> { playerId, username, firstSeen, lastSeen, actionCount }

class AdminError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Every admin route calls this. It verifies the code AND records who
// used it — the two were previously separate concerns, which is how the
// attribution gap happened.
function authenticate(playerId, username, code, expectedCode, action) {
  if (!code || code !== expectedCode) {
    // Failed attempts are logged too — a burst of these is the signal
    // that the code has leaked.
    record(playerId, username, 'AUTH_FAILED', { action, attempted: true }, false);
    throw new AdminError('ADMIN_ONLY', 'Chris Admin Only — no access');
  }
  const player = playerId ? db.players.get(playerId) : null;
  const name = username || (player && player.username) || 'unknown';

  const now = Date.now();
  if (!adminUsers.has(playerId)) {
    adminUsers.set(playerId, { playerId, username: name, firstSeen: now, lastSeen: now, actionCount: 0 });
    record(playerId, name, 'ADMIN_FIRST_LOGIN', {}, true);
  }
  const entry = adminUsers.get(playerId);
  entry.lastSeen = now;
  entry.username = name;
  entry.actionCount += 1;
  return { playerId, username: name };
}

function record(playerId, username, action, details = {}, success = true) {
  adminLog.push({
    id: db.nextId(),
    at: Date.now(),
    playerId: playerId || null,
    username: username || 'unknown',
    action,
    details,
    success,
  });
  // Oldest-first trim so the cap never blocks new entries.
  while (adminLog.length > MAX_LOG_ENTRIES) adminLog.shift();
}

function getLog({ limit = 200, playerId = null, action = null } = {}) {
  let rows = adminLog;
  if (playerId) rows = rows.filter((r) => r.playerId === Number(playerId));
  if (action) rows = rows.filter((r) => r.action === action);
  return {
    entries: rows.slice(-limit).reverse(),
    total: adminLog.length,
    admins: [...adminUsers.values()].sort((a, b) => b.lastSeen - a.lastSeen),
  };
}

// ---- gifting ----
//
// A gift is a bundle: any mix of materials, one optional custom droid,
// and crystals — sent to any number of players at once.
//
// Everything is applied server-side from the catalogue, so a crafted
// request can't invent a material key or a species that doesn't exist.

function giftableMaterials() {
  return db.TRADEABLE_MATERIALS.map((m) => ({ key: m.key, name: m.name }));
}

function giftableSpecies() {
  return db.droidSpecies.map((s) => ({
    id: s.id,
    name: s.name,
    rarity: s.rarity,
    alignment: s.alignment,
    collection: s.collection,
  }));
}

function sendGift(adminPlayerId, adminUsername, { playerIds, materials, droid, crystals, note }) {
  if (!Array.isArray(playerIds) || !playerIds.length) {
    throw new AdminError('NO_RECIPIENTS', 'Select at least one player');
  }

  const recipients = playerIds.map((id) => db.players.get(Number(id))).filter(Boolean);
  if (!recipients.length) throw new AdminError('NO_RECIPIENTS', 'None of those players exist');

  // Validate the whole bundle BEFORE granting anything, so a bad key
  // can't leave half the recipients gifted and half not.
  const validKeys = new Set(db.TRADEABLE_MATERIALS.map((m) => m.key));
  const cleanMaterials = {};
  Object.entries(materials || {}).forEach(([k, v]) => {
    const amount = Math.floor(Number(v) || 0);
    if (!amount) return;
    if (!validKeys.has(k)) throw new AdminError('BAD_MATERIAL', `Unknown material: ${k}`);
    if (amount < 0) throw new AdminError('BAD_AMOUNT', 'Amounts must be positive');
    cleanMaterials[k] = amount;
  });

  let species = null;
  if (droid && droid.speciesId) {
    species = db.droidSpecies.find((s) => s.id === Number(droid.speciesId));
    if (!species) throw new AdminError('BAD_SPECIES', 'Unknown droid species');
  }

  const crystalAmount = Math.max(0, Math.floor(Number(crystals) || 0));
  const now = Date.now();
  const results = [];

  recipients.forEach((player) => {
    Object.entries(cleanMaterials).forEach(([k, v]) => {
      player[k] = (player[k] || 0) + v;
    });

    if (crystalAmount) {
      player.crystalBalance = (player.crystalBalance || 0) + crystalAmount;
      db.crystalTransactions.push({
        id: db.nextId(), playerId: player.id, amount: crystalAmount,
        source: 'admin_gift', createdAt: now,
      });
    }

    let newDroidId = null;
    if (species) {
      const level = Math.min(db.DROID_LEVEL_CAP, Math.max(1, Math.floor(Number(droid.level) || 1)));
      const variant = ['standard', 'rusty', 'platinum', 'funky'].includes(droid.variant) ? droid.variant : 'standard';
      const d = {
        id: db.nextId(),
        playerId: player.id,
        speciesId: species.id,
        variant,
        level,
        captureCost: 0,
        capturedAt: now,
        workshopSlotId: null,
        currentHpDamage: 0,
        hiddenFromTrade: false,
        giftedByAdmin: true,
      };
      if (variant === 'funky' && droid.color) d.color = droid.color;
      db.ownedDroids.set(d.id, d);
      db.markDexSeen(player.id, species.id, variant);
      newDroidId = d.id;
    }

    // Delivered as a redeemable notice so the player sees what arrived
    // rather than silently finding extra materials.
    player.giftInbox = player.giftInbox || [];
    player.giftInbox.push({
      id: db.nextId(),
      at: now,
      from: adminUsername || 'Admin',
      note: (note || '').slice(0, 200),
      materials: cleanMaterials,
      crystals: crystalAmount,
      droid: species ? { speciesId: species.id, name: species.name, level: droid.level, variant: droid.variant } : null,
      seen: false,
    });

    results.push({ playerId: player.id, username: player.username, droidId: newDroidId });
  });

  record(adminPlayerId, adminUsername, 'GIFT_SENT', {
    recipients: results.map((r) => r.username),
    recipientCount: results.length,
    materials: cleanMaterials,
    crystals: crystalAmount,
    droid: species ? `${species.name} lv${droid.level || 1} ${droid.variant || 'standard'}` : null,
    note: note || null,
  });

  return { sent: results.length, recipients: results };
}

function playerRoster() {
  return [...db.players.values()]
    .map((p) => ({ id: p.id, username: p.username, level: p.playerLevel || 0 }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function markGiftsSeen(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new AdminError('NO_PLAYER', 'Player not found');
  (player.giftInbox || []).forEach((g) => { g.seen = true; });
  return { inbox: player.giftInbox || [] };
}

module.exports = {
  adminLog,
  adminUsers,
  MAX_LOG_ENTRIES,
  authenticate,
  record,
  getLog,
  sendGift,
  giftableMaterials,
  giftableSpecies,
  playerRoster,
  markGiftsSeen,
  AdminError,
};
