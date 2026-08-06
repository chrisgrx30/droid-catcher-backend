// server.js
//
// Zero-dependency HTTP server (Node's built-in `http` module) so this
// runs anywhere with just `node src/server.js` — no npm install needed.
// In production you'd likely swap this for Express/Fastify, but the
// route handlers below map 1:1 onto what an Express app would look like.

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const spawnsModule = require('./spawns');
const captureModule = require('./capture');
const workshopModule = require('./workshop');
const tradesModule = require('./trades');
const persistence = require('./persistence');

const PORT = process.env.PORT || 3000;

// Serve the test terminal directly from this server so testers only need
// one URL (no separate static host, no CORS config to juggle). Read once
// at startup — restart the process to pick up terminal edits.
const TERMINAL_HTML_PATH = path.join(__dirname, '..', 'test-terminal.html');
let terminalHtml = null;
try {
  terminalHtml = fs.readFileSync(TERMINAL_HTML_PATH, 'utf8');
} catch (e) {
  console.warn('test-terminal.html not found next to src/ — GET / will 404. (Looked in:', TERMINAL_HTML_PATH, ')');
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // GET / -> serve the test terminal itself, so testers only need one URL
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      if (!terminalHtml) return sendJson(res, 404, { error: 'test-terminal.html not found on server' });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(terminalHtml);
    }

    // GET /species -> full species catalog, incl. min crystal cost to attempt capture
    if (req.method === 'GET' && pathname === '/species') {
      const species = db.droidSpecies.map((s) => ({
        ...s,
        minCrystalCost: db.MIN_CRYSTAL_COST[s.rarity],
      }));
      return sendJson(res, 200, { species });
    }

    // POST /players  { username }
    if (req.method === 'POST' && pathname === '/players') {
      const { username } = await readBody(req);
      if (!username) return sendJson(res, 400, { error: 'username required' });
      const player = db.createPlayer(username);
      return sendJson(res, 201, player);
    }

    // GET /players/:id
    if (req.method === 'GET' && pathname.match(/^\/players\/\d+$/)) {
      const id = Number(pathname.split('/')[2]);
      const player = db.players.get(id);
      if (!player) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, player);
    }

    // GET /players/:id/dex -> full species catalog annotated with caught/uncaught
    if (req.method === 'GET' && pathname.match(/^\/players\/\d+\/dex$/)) {
      const playerId = Number(pathname.split('/')[2]);
      return sendJson(res, 200, db.getDex(playerId));
    }

    // POST /players/:id/starter  { speciesId }
    // One-time free starter droid (common tier only) — auto-assigned to the
    // player's first slot so farming begins immediately, no capture needed.
    if (req.method === 'POST' && pathname.match(/^\/players\/\d+\/starter$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const { speciesId } = await readBody(req);
      try {
        const droid = db.grantStarterDroid(playerId, speciesId);
        const firstSlot = [...db.workshopSlots.values()].find(
          (s) => s.playerId === playerId && s.slotIndex === 0
        );
        workshopModule.assignDroidToSlot(playerId, droid.id, firstSlot.id);
        return sendJson(res, 201, { droid: workshopModule.enrichDroid(droid) });
      } catch (e) {
        return sendJson(res, 409, { error: 'STARTER_ERROR', message: e.message });
      }
    }

    // GET /spawns?lat=..&lng=..&radius=500&playerId=1
    if (req.method === 'GET' && pathname === '/spawns') {
      const lat = parseFloat(searchParams.get('lat'));
      const lng = parseFloat(searchParams.get('lng'));
      const radius = parseFloat(searchParams.get('radius') || '500');
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return sendJson(res, 400, { error: 'lat/lng required' });
      }
      spawnsModule.purgeExpiredSpawns();
      const result = spawnsModule.getNearbySpawns(lat, lng, radius);
      return sendJson(res, 200, result);
    }

    // POST /capture-attempt
    // { playerId, spawnId, crystalsSpent, padAccuracy, attemptDurationMs, playerLat, playerLng }
    if (req.method === 'POST' && pathname === '/capture-attempt') {
      const body = await readBody(req);
      try {
        const result = captureModule.resolveCaptureAttempt(body);
        return sendJson(res, 200, result);
      } catch (e) {
        if (e instanceof captureModule.CaptureError) {
          return sendJson(res, 409, { error: e.code, message: e.message });
        }
        throw e;
      }
    }

    // GET /workshop/:playerId  -> settles + returns current state
    if (req.method === 'GET' && pathname.match(/^\/workshop\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const settled = workshopModule.settleEarnings(playerId);
      const player = db.players.get(playerId);
      const slots = [...db.workshopSlots.values()]
        .filter((s) => s.playerId === playerId)
        .map((s) => ({ ...s, unlockCost: s.unlocked ? null : db.slotUnlockCost(s.slotIndex) }));
      const droids = [...db.ownedDroids.values()]
        .filter((d) => d.playerId === playerId)
        .map(workshopModule.enrichDroid);
      const crystalsPerSecond =
        droids.reduce((sum, d) => sum + (d.crystalsPerMinute || 0), 0) / 60;
      return sendJson(res, 200, {
        ...settled,
        slots,
        droids,
        crystalsPerSecond,
        padLevel: player.padLevel,
        critChance: db.critChanceForPadLevel(player.padLevel),
        nextPadUpgradeCost: db.padUpgradeCost(player.padLevel),
      });
    }

    // POST /workshop/assign  { playerId, droidId, slotId }
    if (req.method === 'POST' && pathname === '/workshop/assign') {
      const { playerId, droidId, slotId } = await readBody(req);
      const droid = workshopModule.assignDroidToSlot(playerId, droidId, slotId);
      return sendJson(res, 200, { droid: workshopModule.enrichDroid(droid) });
    }

    // POST /workshop/unassign  { playerId, droidId }
    if (req.method === 'POST' && pathname === '/workshop/unassign') {
      const { playerId, droidId } = await readBody(req);
      const droid = workshopModule.unassignDroid(playerId, droidId);
      return sendJson(res, 200, { droid: workshopModule.enrichDroid(droid) });
    }

    // POST /workshop/unlock-slot  { playerId, slotId }
    if (req.method === 'POST' && pathname === '/workshop/unlock-slot') {
      const { playerId, slotId } = await readBody(req);
      try {
        const result = workshopModule.unlockSlot(playerId, slotId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'UNLOCK_ERROR', message: e.message });
      }
    }

    // POST /droids/:id/level-up  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/level-up$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.levelUpDroid(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'LEVEL_UP_ERROR', message: e.message });
      }
    }

    // POST /players/:id/upgrade-pad
    if (req.method === 'POST' && pathname.match(/^\/players\/\d+\/upgrade-pad$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        const result = workshopModule.upgradePad(playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'PAD_UPGRADE_ERROR', message: e.message });
      }
    }

    // GET /events -> currently active time-exclusive events
    if (req.method === 'GET' && pathname === '/events') {
      return sendJson(res, 200, { events: db.listActiveEvents() });
    }

    // POST /events  { name, speciesIds?, collection?, spawnWeightMultiplier, startTime, endTime }
    // Dev/admin endpoint for this prototype — production would gate this behind admin auth.
    if (req.method === 'POST' && pathname === '/events') {
      const body = await readBody(req);
      try {
        const event = db.createEvent(body);
        return sendJson(res, 201, { event });
      } catch (e) {
        return sendJson(res, 400, { error: 'EVENT_ERROR', message: e.message });
      }
    }

    // POST /trades  { fromPlayerId, toPlayerId, offeredDroidIds, offeredCrystals, requestedDroidIds, requestedCrystals }
    if (req.method === 'POST' && pathname === '/trades') {
      const body = await readBody(req);
      try {
        const offer = tradesModule.createTradeOffer(body);
        return sendJson(res, 201, { offer });
      } catch (e) {
        if (e instanceof tradesModule.TradeError) {
          return sendJson(res, 409, { error: e.code, message: e.message });
        }
        throw e;
      }
    }

    // GET /trades/:playerId -> all trades (any status) involving this player
    if (req.method === 'GET' && pathname.match(/^\/trades\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      return sendJson(res, 200, { trades: tradesModule.listTradesForPlayer(playerId) });
    }

    // POST /trades/:id/accept  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/trades\/\d+\/accept$/)) {
      const tradeId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const offer = tradesModule.acceptTradeOffer(tradeId, playerId);
        return sendJson(res, 200, { offer });
      } catch (e) {
        if (e instanceof tradesModule.TradeError) {
          return sendJson(res, 409, { error: e.code, message: e.message });
        }
        throw e;
      }
    }

    // POST /trades/:id/decline  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/trades\/\d+\/decline$/)) {
      const tradeId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const offer = tradesModule.declineTradeOffer(tradeId, playerId);
        return sendJson(res, 200, { offer });
      } catch (e) {
        if (e instanceof tradesModule.TradeError) {
          return sendJson(res, 409, { error: e.code, message: e.message });
        }
        throw e;
      }
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: 'internal_error', message: err.message });
  }
});

persistence.load().then(() => {
  server.listen(PORT, () => {
    console.log(`Droid Catcher backend running on http://localhost:${PORT}`);
    persistence.startAutoSave();
    persistence.registerShutdownHook();
  });
});

module.exports = server;
