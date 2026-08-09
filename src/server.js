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
const joystickModule = require('./joystick');
const levelsModule = require('./levels');
const buffsModule = require('./buffs');
const attachmentsModule = require('./attachments');
const cosmeticsModule = require('./cosmetics');
const presenceModule = require('./presence');
const realtimeModule = require('./realtime');
const livepvpModule = require('./livepvp');
const workshopModule = require('./workshop');
const battleModule = require('./battle');
const factoryModule = require('./factory');
const tradesModule = require('./trades');
const persistence = require('./persistence');

const PORT = process.env.PORT || 3000;

// Simple admin-code gate for the two "anyone who finds this URL could call
// it" dev endpoints — events (spawn manipulation) and redeem-code creation
// (free crystals/droids). Deliberately basic (a shared code, not real
// auth) for a closed friends beta; would need real admin auth before this
// goes anywhere more public.
// Read from environment variables in production (Render) so these
// aren't sitting in plain text in a public GitHub repo. Falls back to
// the existing defaults only if the env vars aren't set, so local dev
// still works without extra setup.
const ADMIN_CODES = {
  events: process.env.ADMIN_CODE_EVENTS || '2026',
  redeemCodes: process.env.ADMIN_CODE_REDEEM || '3103',
};

// Static image assets — drop droid art here (see assets/droids/README.md
// for the exact filenames each species expects). Served directly, not read
// into memory at startup, so images added later don't need a restart.
const ASSETS_DROIDS_DIR = path.join(__dirname, '..', 'assets', 'droids');
const ASSETS_COSMETICS_DIR = path.join(__dirname, '..', 'assets', 'cosmetics');
const ASSETS_OUTFITS_DIR = path.join(__dirname, '..', 'assets', 'outfits');
const ASSETS_MISC_DIR = path.join(__dirname, '..', 'assets', 'misc');
const ASSETS_HOME_DIR = path.join(__dirname, '..', 'assets', 'home');
const ASSETS_BATTLE_DIR = path.join(__dirname, '..', 'assets', 'battle');
const ASSETS_POSTERS_DIR = path.join(__dirname, '..', 'assets', 'home', 'posters');
// Apex set art — backgrounds for the Apex battle box, the Apex Hunt
// banner, and anything else Apex-themed. Drop PNG/GIF files in
// assets/apex/ and reference them as /assets/apex/<name>.png
const ASSETS_APEX_DIR = path.join(__dirname, '..', 'assets', 'apex');

// ---- v0.4 asset folders ----
// All lowercase, no spaces. Linux (which Render runs) treats paths as
// case-sensitive and URLs can't contain raw spaces, so "Achievements"
// and "Battle Equipment" would both fail to serve. Use these names.
const EXTRA_ASSET_DIRS = {
  attachments:  path.join(__dirname, '..', 'assets', 'attachments'),
  equipment:    path.join(__dirname, '..', 'assets', 'equipment'),
  achievements: path.join(__dirname, '..', 'assets', 'achievements'),
  levels:       path.join(__dirname, '..', 'assets', 'levels'),
  materials:    path.join(__dirname, '..', 'assets', 'materials'),
};
const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

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

  // ---- presence ----
  // Any request carrying a player id refreshes that player's "last
  // seen" clock. The client already polls, so an open tab keeps itself
  // marked online with no extra traffic. Reads the id from the query
  // string or the path; POST bodies are handled per-route where the
  // body is already parsed.
  {
    const qsId = searchParams.get('playerId');
    if (qsId) presenceModule.touch(Number(qsId));
    const pathId = pathname.match(/^\/(?:workshop|levels|buffs|attachments|cosmetics2|joystick|friends|dex)\/(\d+)/);
    if (pathId) presenceModule.touch(Number(pathId[1]));
  }

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

    // GET /guide -> serves the player guide directly, so the in-app link
    // always works regardless of where else it's hosted.
    if (req.method === 'GET' && pathname === '/guide') {
      try {
        const guideText = fs.readFileSync(path.join(__dirname, '..', 'player-guide.md'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(guideText);
      } catch (e) {
        return sendJson(res, 404, { error: 'player-guide.md not found on server' });
      }
    }

    // GET /assets/droids/<filename> -> serves droid artwork if present.
    // Filename is strictly whitelisted (letters/digits/-/_ + one extension)
    // before touching the filesystem — this is public-internet-facing, so
    // no room for path-traversal ("../../etc/passwd" etc).
    if (req.method === 'GET' && pathname.startsWith('/assets/droids/')) {
      const filename = pathname.slice('/assets/droids/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_DROIDS_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/<folder>/<file> for the v0.4 art folders. One handler
    // instead of five near-identical blocks — the older folders above
    // predate this and were left alone rather than refactored.
    {
      const m = pathname.match(/^\/assets\/([a-z]+)\/([^/]+)$/);
      if (req.method === 'GET' && m && EXTRA_ASSET_DIRS[m[1]]) {
        const filename = m[2];
        if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
          return sendJson(res, 400, { error: 'invalid filename' });
        }
        try {
          const data = fs.readFileSync(path.join(EXTRA_ASSET_DIRS[m[1]], filename));
          const ext = path.extname(filename).toLowerCase();
          res.writeHead(200, {
            'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
          });
          return res.end(data);
        } catch (e) {
          return sendJson(res, 404, { error: 'image not found' });
        }
      }
    }

    // GET /assets/apex/<filename> -> Apex set backgrounds and theming art
    if (req.method === 'GET' && pathname.startsWith('/assets/apex/')) {
      const filename = pathname.slice('/assets/apex/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_APEX_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/cosmetics/<filename> -> same pattern as droid artwork above
    if (req.method === 'GET' && pathname.startsWith('/assets/cosmetics/')) {
      const filename = pathname.slice('/assets/cosmetics/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_COSMETICS_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/outfits/<filename> -> same pattern, for outfit art
    if (req.method === 'GET' && pathname.startsWith('/assets/outfits/')) {
      const filename = pathname.slice('/assets/outfits/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_OUTFITS_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/misc/<filename> -> same pattern, for one-off generic art
    // (egg icon, control pad background, alignment spawn-card backgrounds,
    // the Farm "droid working" animation)
    if (req.method === 'GET' && pathname.startsWith('/assets/misc/')) {
      const filename = pathname.slice('/assets/misc/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_MISC_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/home/<filename> -> logo.png / icon.png
    if (req.method === 'GET' && pathname.startsWith('/assets/home/') && !pathname.startsWith('/assets/home/posters/')) {
      const filename = pathname.slice('/assets/home/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_HOME_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/battle/<filename> -> hp.png / attack.png / special.png
    if (req.method === 'GET' && pathname.startsWith('/assets/battle/')) {
      const filename = pathname.slice('/assets/battle/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_BATTLE_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /assets/home/posters/<filename> -> any poster, any filename
    if (req.method === 'GET' && pathname.startsWith('/assets/home/posters/')) {
      const filename = pathname.slice('/assets/home/posters/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
        return sendJson(res, 400, { error: 'invalid filename' });
      }
      const filePath = path.join(ASSETS_POSTERS_DIR, filename);
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        res.writeHead(200, {
          'Content-Type': IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(data);
      } catch (e) {
        return sendJson(res, 404, { error: 'image not found' });
      }
    }

    // GET /home-posters?playerId=X -> lists whatever poster filenames currently
    // exist (minus ones this player dismissed), plus reaction counts.
    // New posters need zero code changes, just drop the file in.
    if (req.method === 'GET' && pathname === '/home-posters') {
      try {
        const playerId = searchParams.get('playerId') ? Number(searchParams.get('playerId')) : null;
        const player = playerId ? db.players.get(playerId) : null;
        const dismissed = player?.dismissedPosters || [];
        const files = fs.readdirSync(ASSETS_POSTERS_DIR)
          .filter((f) => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f))
          .filter((f) => !dismissed.includes(f));
        const posters = files.map((filename) => ({ filename, ...db.getPosterReactions(filename, playerId) }));
        return sendJson(res, 200, { posters });
      } catch (e) {
        return sendJson(res, 200, { posters: [] }); // folder doesn't exist yet — not an error, just nothing to show
      }
    }

    // POST /home-posters/react  { playerId, filename, reaction }
    if (req.method === 'POST' && pathname === '/home-posters/react') {
      const { playerId, filename, reaction } = await readBody(req);
      try {
        const result = db.reactToPoster(playerId, filename, reaction);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'REACT_ERROR', message: e.message });
      }
    }

    // POST /home-posters/dismiss  { playerId, filename }
    if (req.method === 'POST' && pathname === '/home-posters/dismiss') {
      const { playerId, filename } = await readBody(req);
      try {
        const result = db.dismissPoster(playerId, filename);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'DISMISS_ERROR', message: e.message });
      }
    }

    // GET /species -> full species catalog, incl. min crystal cost to attempt capture
    if (req.method === 'GET' && pathname === '/species') {
      const species = db.droidSpecies.map((s) => ({
        ...s,
        minCrystalCost: db.MIN_CRYSTAL_COST[s.rarity],
      }));
      return sendJson(res, 200, { species });
    }

    // POST /players  { username, pin }
    // Unified login/signup: existing username+matching PIN resumes that
    // player (any device); new username creates a fresh one; an existing
    // username with no PIN yet set (pre-login-system account) claims the
    // PIN provided now, so old testers don't lose progress after this update.
    if (req.method === 'POST' && pathname === '/players') {
      const { username, pin } = await readBody(req);
      try {
        const player = db.loginOrCreatePlayer(username, pin);
        return sendJson(res, 200, player);
      } catch (e) {
        return sendJson(res, 400, { error: 'LOGIN_ERROR', message: e.message });
      }
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
      const playerId = searchParams.get('playerId') ? Number(searchParams.get('playerId')) : null;
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return sendJson(res, 400, { error: 'lat/lng required' });
      }
      try {
        db.checkScanRateLimit(playerId);
      } catch (e) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: e.message });
      }
      spawnsModule.purgeExpiredSpawns();
      const result = spawnsModule.getNearbySpawns(lat, lng, radius, playerId);
      return sendJson(res, 200, result);
    }

    // POST /spawns/:id/flee  { playerId } -> back out of a capture attempt; the spawn is gone for good
    if (req.method === 'POST' && pathname.match(/^\/spawns\/\d+\/flee$/)) {
      const spawnId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = spawnsModule.fleeSpawn(spawnId, playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'FLEE_ERROR', message: e.message });
      }
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
      if (player) player.lastOnline = Date.now();
      const slots = [...db.workshopSlots.values()]
        .filter((s) => s.playerId === playerId)
        .map((s) => ({ ...s, unlockCost: s.unlocked ? null : db.slotUnlockCost(s.slotIndex) }));
      const droids = [...db.ownedDroids.values()]
        .filter((d) => d.playerId === playerId)
        .map(workshopModule.enrichDroid);
      const companionMultiplier = workshopModule.companionBuffMultiplier(playerId);
      const crystalsPerSecond =
        (droids.reduce((sum, d) => sum + (d.crystalsPerMinute || 0), 0) / 60) * companionMultiplier;
      const companionDroid = player.companionDroidId
        ? workshopModule.enrichDroid(db.ownedDroids.get(player.companionDroidId))
        : null;
      return sendJson(res, 200, {
        ...settled,
        slots,
        droids,
        crystalsPerSecond,
        padLevel: player.padLevel,
        critChance: db.critChanceForPadLevel(player.padLevel),
        nextPadUpgradeCost: db.padUpgradeCost(player.padLevel),
        paint: player.paint,
        novaChips: player.novaChips,
        cosmetics: player.cosmetics,
        equippedCosmetics: player.equippedCosmetics || { head: null, body: null, arms: null, legs: null },
        buffs: workshopModule.getPlayerBuffsSummary(playerId).buffs,
        offlineProjection: workshopModule.calculateOfflineProjection(playerId),
        guildId: player.guildId,
        companionDroid,
        companionBuffType: companionDroid ? db.droidSpecies.find((s) => s.id === companionDroid.speciesId)?.companionBuffType : null,
        companionBuffPercent: companionDroid ? db.droidSpecies.find((s) => s.id === companionDroid.speciesId)?.companionBuffPercent : null,
        beacons: player.beacons,
        beaconActiveUntil: player.beaconActiveUntil,
        augmentCores: player.augmentCores,
        padRam: player.padRam,
        repairKits: player.repairKits,
        energyTubes: player.energyTubes,
        displayedBadge: player.displayedBadge,
        padRamNeededNext: db.padRequiresRam(player.padLevel + 1),
        timeWarps: player.timeWarps,
        autoReleaseDuplicates: player.autoReleaseDuplicates,
        autoReleaseIncludeVariants: player.autoReleaseIncludeVariants,
        growths: player.growths,
        outfit: player.outfit,
        ownedOutfits: player.ownedOutfits,
        // v0.2 currencies
        apexCubes: player.apexCubes || 0,
        titanTokens: player.titanTokens || 0,
        guildTokens: player.guildTokens || 0,
        joyCoins: player.joyCoins || 0,
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

    // POST /droids/:id/release  { playerId } -> scrap for 1.5x captureCost refund + 10% Nova Chip chance
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/release$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.releaseDroid(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'RELEASE_ERROR', message: e.message });
      }
    }

    // POST /droids/release-bulk  { playerId, droidIds: [] } -> settles once, returns one summed result
    if (req.method === 'POST' && pathname === '/droids/release-bulk') {
      const { playerId, droidIds } = await readBody(req);
      try {
        if (!Array.isArray(droidIds) || !droidIds.length) throw new Error('droidIds must be a non-empty array');
        const result = workshopModule.releaseDroidsBulk(playerId, droidIds);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'RELEASE_BULK_ERROR', message: e.message });
      }
    }

    // POST /droids/:id/evolve-species  { playerId } -> spend Nova Chips (e.g. Leafkin -> Bushy)
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/evolve-species$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.evolveSpecies(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'EVOLVE_ERROR', message: e.message });
      }
    }

    // POST /droids/:id/toggle-hidden-from-trade  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/toggle-hidden-from-trade$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.toggleHiddenFromTrade(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'TOGGLE_ERROR', message: e.message });
      }
    }

    // POST /droids/:id/master-scaffitan  { playerId } -> spend Energy Tubes to mastery-tier up
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/master-scaffitan$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.masterScaffitan(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'MASTERY_ERROR', message: e.message });
      }
    }

    // POST /droids/:id/heal  { playerId } -> spend 1 Repair Kit to fully heal a fainted droid
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/heal$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.healDroid(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'HEAL_ERROR', message: e.message });
      }
    }

    // POST /droids/:id/evolve-funky  { playerId, color } -> spend Paint on a Rusty droid
    if (req.method === 'POST' && pathname.match(/^\/droids\/\d+\/evolve-funky$/)) {
      const droidId = Number(pathname.split('/')[2]);
      const { playerId, color } = await readBody(req);
      try {
        const result = workshopModule.evolveFunky(playerId, droidId, color);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'EVOLVE_FUNKY_ERROR', message: e.message });
      }
    }

    // POST /companion/assign  { playerId, droidId }
    if (req.method === 'POST' && pathname === '/companion/assign') {
      const { playerId, droidId } = await readBody(req);
      try {
        const result = workshopModule.assignCompanion(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'COMPANION_ERROR', message: e.message });
      }
    }

    // POST /companion/activate  { playerId, droidId } -> starts a capture-rate buff's 1hr active window
    if (req.method === 'POST' && pathname === '/companion/activate') {
      const { playerId, droidId } = await readBody(req);
      try {
        const result = db.activateCompanionBuff(playerId, droidId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'COMPANION_ERROR', message: e.message });
      }
    }

    // GET /factory/:playerId -> full Factory state: processor slots, unassigned eggs, costs
    if (req.method === 'GET' && pathname.match(/^\/factory\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const slots = [...db.processorSlots.values()]
        .filter((s) => s.playerId === playerId)
        .map((s) => ({ ...s, unlockCost: s.unlocked ? null : db.PROCESSOR_SLOT_COSTS[s.slotIndex] }));
      const unassignedEggs = [...db.eggs.values()].filter((e) => e.playerId === playerId);
      const player = db.players.get(playerId);
      return sendJson(res, 200, {
        slots,
        eggs: unassignedEggs,
        factoryCooldownUntil: player ? player.factoryCooldownUntil : null,
        minigameCost: db.FACTORY_MINIGAME_COST,
        startHatchCost: db.FACTORY_START_HATCH_COST,
      });
    }

    // GET /depot/:playerId -> cooldown status + cost
    if (req.method === 'GET' && pathname.match(/^\/depot\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const player = db.players.get(playerId);
      if (!player) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { depotCooldownUntil: player.depotCooldownUntil, minigameCost: db.DEPOT_MINIGAME_COST });
    }

    // POST /depot/attempt  { playerId, closeness, attemptDurationMs }
    if (req.method === 'POST' && pathname === '/depot/attempt') {
      const { playerId, closeness, attemptDurationMs } = await readBody(req);
      try {
        const result = db.attemptDepot(playerId, closeness, attemptDurationMs);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'DEPOT_ERROR', message: e.message });
      }
    }

    // POST /beacon/buy  { playerId, quantity }
    if (req.method === 'POST' && pathname === '/beacon/buy') {
      const { playerId, quantity } = await readBody(req);
      try {
        const result = db.buyBeacon(playerId, quantity);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'BEACON_ERROR', message: e.message });
      }
    }

    // POST /beacon/activate  { playerId }
    if (req.method === 'POST' && pathname === '/beacon/activate') {
      const { playerId } = await readBody(req);
      try {
        const result = db.activateBeacon(playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'BEACON_ERROR', message: e.message });
      }
    }

    // POST /factory/unlock-slot  { playerId, slotId }
    if (req.method === 'POST' && pathname === '/factory/unlock-slot') {
      const { playerId, slotId } = await readBody(req);
      try {
        const result = factoryModule.unlockProcessorSlot(playerId, slotId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: e.code || 'FACTORY_ERROR', message: e.message });
      }
    }

    // POST /factory/attempt  { playerId, hit, attemptDurationMs }
    if (req.method === 'POST' && pathname === '/factory/attempt') {
      const { playerId, hit, attemptDurationMs } = await readBody(req);
      try {
        const result = factoryModule.attemptFactoryMinigame(playerId, !!hit, attemptDurationMs);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: e.code || 'FACTORY_ERROR', message: e.message });
      }
    }

    // POST /factory/assign  { playerId, eggId, slotId }
    if (req.method === 'POST' && pathname === '/factory/assign') {
      const { playerId, eggId, slotId } = await readBody(req);
      try {
        const result = factoryModule.assignEggToProcessor(playerId, eggId, slotId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: e.code || 'FACTORY_ERROR', message: e.message });
      }
    }

    // POST /factory/collect  { playerId, slotId }
    if (req.method === 'POST' && pathname === '/factory/collect') {
      const { playerId, slotId } = await readBody(req);
      try {
        const result = factoryModule.collectPrototype(playerId, slotId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: e.code || 'FACTORY_ERROR', message: e.message });
      }
    }

    // POST /factory/crush-egg  { playerId, eggId }
    if (req.method === 'POST' && pathname === '/factory/crush-egg') {
      const { playerId, eggId } = await readBody(req);
      try {
        const result = factoryModule.crushEgg(playerId, eggId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: e.code || 'FACTORY_ERROR', message: e.message });
      }
    }

    // POST /factory/crush-slot  { playerId, slotId }
    if (req.method === 'POST' && pathname === '/factory/crush-slot') {
      const { playerId, slotId } = await readBody(req);
      try {
        const result = factoryModule.crushIncubatingEgg(playerId, slotId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: e.code || 'FACTORY_ERROR', message: e.message });
      }
    }

    // POST /companion/unassign  { playerId }
    if (req.method === 'POST' && pathname === '/companion/unassign') {
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.unassignCompanion(playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'COMPANION_ERROR', message: e.message });
      }
    }

    // GET /cosmetics -> catalog
    if (req.method === 'GET' && pathname === '/cosmetics') {
      return sendJson(res, 200, { cosmetics: db.COSMETICS_CATALOG });
    }

    // POST /players/:id/cosmetics/buy  { cosmeticId }
    if (req.method === 'POST' && pathname.match(/^\/players\/\d+\/cosmetics\/buy$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const { cosmeticId } = await readBody(req);
      try {
        const result = workshopModule.buyCosmetic(playerId, cosmeticId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'COSMETIC_ERROR', message: e.message });
      }
    }

    // POST /players/:id/cosmetics/equip  { slot, cosmeticId }
    if (req.method === 'POST' && pathname.match(/^\/players\/\d+\/cosmetics\/equip$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const { slot, cosmeticId } = await readBody(req);
      try {
        const result = workshopModule.equipCosmetic(playerId, slot, cosmeticId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'COSMETIC_ERROR', message: e.message });
      }
    }

    // POST /players/:id/cosmetics/unequip  { slot }
    if (req.method === 'POST' && pathname.match(/^\/players\/\d+\/cosmetics\/unequip$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const { slot } = await readBody(req);
      try {
        const result = workshopModule.unequipCosmetic(playerId, slot);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'COSMETIC_ERROR', message: e.message });
      }
    }

    // GET /materials -> canonical tradeable materials list
    if (req.method === 'GET' && pathname === '/materials') {
      return sendJson(res, 200, { materials: db.TRADEABLE_MATERIALS });
    }

    // GET /shop -> the full catalog (materials + outfits)
    if (req.method === 'GET' && pathname === '/shop') {
      return sendJson(res, 200, { items: db.SHOP_CATALOG });
    }

    // POST /shop/buy-basket  { playerId, items: [{itemId, quantity}] }
    if (req.method === 'POST' && pathname === '/shop/buy-basket') {
      const { playerId, items } = await readBody(req);
      try {
        const result = db.buyShopBasket(playerId, items);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'SHOP_ERROR', message: e.message });
      }
    }

    // POST /shop/buy  { playerId, itemId, quantity }
    if (req.method === 'POST' && pathname === '/shop/buy') {
      const { playerId, itemId, quantity } = await readBody(req);
      try {
        const result = db.buyShopItem(playerId, itemId, quantity);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'SHOP_ERROR', message: e.message });
      }
    }

    // POST /player/use-time-warp  { playerId }
    if (req.method === 'POST' && pathname === '/player/use-time-warp') {
      const { playerId } = await readBody(req);
      try {
        const result = db.useTimeWarp(playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'PLUGIN_ERROR', message: e.message });
      }
    }

    // POST /player/use-growth  { playerId }
    if (req.method === 'POST' && pathname === '/player/use-growth') {
      const { playerId } = await readBody(req);
      try {
        const result = db.useGrowth(playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'PLUGIN_ERROR', message: e.message });
      }
    }

    // POST /player/cleanup-duplicates  { playerId } -> one-time retroactive sweep of existing Warehouse duplicates
    if (req.method === 'POST' && pathname === '/player/cleanup-duplicates') {
      const { playerId } = await readBody(req);
      try {
        const result = workshopModule.cleanupExistingDuplicates(playerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'CLEANUP_ERROR', message: e.message });
      }
    }

    // POST /player/auto-release-duplicates  { playerId, enabled }
    if (req.method === 'POST' && pathname === '/player/auto-release-duplicates') {
      const { playerId, enabled } = await readBody(req);
      try {
        const result = db.setAutoReleaseDuplicates(playerId, enabled);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'SETTING_ERROR', message: e.message });
      }
    }

    // POST /player/auto-release-include-variants  { playerId, enabled }
    if (req.method === 'POST' && pathname === '/player/auto-release-include-variants') {
      const { playerId, enabled } = await readBody(req);
      try {
        const result = db.setAutoReleaseIncludeVariants(playerId, enabled);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'SETTING_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/catch-titan  { playerId, padAccuracy, crystalsSpent }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/catch-titan$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId, padAccuracy, crystalsSpent } = await readBody(req);
      try {
        const result = battleModule.attemptScaffitanCapture(battleId, playerId, padAccuracy, crystalsSpent);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'CAPTURE_ERROR', message: e.message });
      }
    }

    // POST /battles/titan-group  { creatorId, invitedPlayerIds, teamDroidIds }
    if (req.method === 'POST' && pathname === '/battles/titan-group') {
      const { creatorId, invitedPlayerIds, teamDroidIds } = await readBody(req);
      try {
        const b = battleModule.createGroupTitanChallenge(creatorId, invitedPlayerIds, teamDroidIds);
        return sendJson(res, 201, { battle: battleModule.getBattleView(b.id) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/join  { playerId, teamDroidIds }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/join$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId, teamDroidIds } = await readBody(req);
      try {
        battleModule.joinGroupTitanBattle(battleId, playerId, teamDroidIds);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/start  { playerId } -> creator starts the fight
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/start$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        battleModule.startGroupTitanBattle(battleId, playerId);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/attack-group  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/attack-group$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = battleModule.attackGroupTitan(battleId, playerId);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId), logEntry: result.logEntry });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // ---- APEX ENCOUNTERS ----
    // POST /battles/apex  { creatorId, invitedPlayerIds, teamDroidIds }
    if (req.method === 'POST' && pathname === '/battles/apex') {
      const { creatorId, invitedPlayerIds, teamDroidIds } = await readBody(req);
      try {
        const battle = battleModule.createApexChallenge(creatorId, invitedPlayerIds || [], teamDroidIds);
        return sendJson(res, 201, { battle: battleModule.getBattleView(battle.id) });
      } catch (e) {
        return sendJson(res, 400, { error: 'APEX_BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/apex-join  { playerId, teamDroidIds }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/apex-join$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId, teamDroidIds } = await readBody(req);
      try {
        const battle = battleModule.joinApexBattle(battleId, playerId, teamDroidIds);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battle.id) });
      } catch (e) {
        return sendJson(res, 400, { error: 'APEX_BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/apex-start  { creatorId }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/apex-start$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { creatorId } = await readBody(req);
      try {
        const battle = battleModule.startApexBattle(battleId, creatorId);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battle.id) });
      } catch (e) {
        return sendJson(res, 400, { error: 'APEX_BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/apex-attack  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/apex-attack$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = battleModule.attackApex(battleId, playerId);
        return sendJson(res, 200, { battle: battleModule.getBattleView(result.battle.id), logEntry: result.logEntry });
      } catch (e) {
        return sendJson(res, 400, { error: 'APEX_BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/titan  { playerId, teamDroidIds } -> solo Titan encounter
    if (req.method === 'POST' && pathname === '/battles/titan') {
      const { playerId, teamDroidIds } = await readBody(req);
      try {
        const b = battleModule.createSoloTitanBattle(playerId, teamDroidIds);
        return sendJson(res, 201, { battle: battleModule.getBattleView(b.id) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/challenge  { challengerId, opponentId, teamDroidIds }
    if (req.method === 'POST' && pathname === '/battles/challenge') {
      const { challengerId, opponentId, teamDroidIds } = await readBody(req);
      try {
        const b = battleModule.createChallenge(challengerId, opponentId, teamDroidIds);
        return sendJson(res, 201, { battle: battleModule.getBattleView(b.id) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/accept  { playerId, teamDroidIds }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/accept$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId, teamDroidIds } = await readBody(req);
      try {
        battleModule.acceptChallenge(battleId, playerId, teamDroidIds);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/decline  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/decline$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        battleModule.declineChallenge(battleId, playerId);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId) });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // POST /battles/:id/attack  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/battles\/\d+\/attack$/)) {
      const battleId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = battleModule.attack(battleId, playerId);
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId), logEntry: result.logEntry });
      } catch (e) {
        return sendJson(res, 409, { error: 'BATTLE_ERROR', message: e.message });
      }
    }

    // GET /battles/:id
    if (req.method === 'GET' && pathname.match(/^\/battles\/\d+$/)) {
      const battleId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, { battle: battleModule.getBattleView(battleId) });
      } catch (e) {
        return sendJson(res, 404, { error: 'NOT_FOUND', message: e.message });
      }
    }

    // GET /players/:id/battles -> everything involving this player, for polling
    if (req.method === 'GET' && pathname.match(/^\/players\/\d+\/battles$/)) {
      const playerId = Number(pathname.split('/')[2]);
      return sendJson(res, 200, { battles: battleModule.getBattlesForPlayer(playerId) });
    }

    // POST /player/change-pin  { playerId, currentPin, newPin }
    if (req.method === 'POST' && pathname === '/player/change-pin') {
      const { playerId, currentPin, newPin } = await readBody(req);
      try {
        const result = db.changePin(playerId, currentPin, newPin);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'PIN_ERROR', message: e.message });
      }
    }

    // POST /player/equip-outfit  { playerId, outfitId }
    if (req.method === 'POST' && pathname === '/player/equip-outfit') {
      const { playerId, outfitId } = await readBody(req);
      try {
        const result = db.equipOutfit(playerId, outfitId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'OUTFIT_ERROR', message: e.message });
      }
    }

    // GET /guilds -> list all (for browsing to join)
    if (req.method === 'GET' && pathname === '/guilds') {
      return sendJson(res, 200, { guilds: [...db.guilds.values()] });
    }

    // GET /guilds/:id
    if (req.method === 'GET' && pathname.match(/^\/guilds\/\d+$/)) {
      const guildId = Number(pathname.split('/')[2]);
      const guild = db.guilds.get(guildId);
      if (!guild) return sendJson(res, 404, { error: 'not found' });
      const members = guild.memberIds.map((id) => {
        const p = db.players.get(id);
        return { id, username: p ? p.username : '(unknown)' };
      });
      return sendJson(res, 200, { ...guild, members });
    }

    // POST /guilds  { playerId, name }
    if (req.method === 'POST' && pathname === '/guilds') {
      const { playerId, name } = await readBody(req);
      try {
        if (!name || !name.trim()) throw new Error('Guild name required');
        const guild = db.createGuild(playerId, name.trim());
        return sendJson(res, 201, { guild });
      } catch (e) {
        return sendJson(res, 409, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // POST /guilds/:id/join  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/guilds\/\d+\/join$/)) {
      const guildId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const guild = db.joinGuild(playerId, guildId);
        return sendJson(res, 200, { guild });
      } catch (e) {
        return sendJson(res, 409, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // POST /guilds/:id/kick  { kickerId, targetPlayerId }
    if (req.method === 'POST' && pathname.match(/^\/guilds\/\d+\/kick$/)) {
      const guildId = Number(pathname.split('/')[2]);
      const { kickerId, targetPlayerId } = await readBody(req);
      try {
        const guild = db.kickFromGuild(kickerId, guildId, targetPlayerId);
        return sendJson(res, 200, { guild });
      } catch (e) {
        return sendJson(res, 409, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // GET /guilds/:id/chat
    if (req.method === 'GET' && pathname.match(/^\/guilds\/\d+\/chat$/)) {
      const guildId = Number(pathname.split('/')[2]);
      return sendJson(res, 200, { messages: db.getGuildMessages(guildId) });
    }

    // POST /guilds/:id/chat  { playerId, text }
    if (req.method === 'POST' && pathname.match(/^\/guilds\/\d+\/chat$/)) {
      const guildId = Number(pathname.split('/')[2]);
      const { playerId, text } = await readBody(req);
      try {
        const message = db.postGuildMessage(playerId, guildId, text);
        return sendJson(res, 201, { message });
      } catch (e) {
        return sendJson(res, 409, { error: 'CHAT_ERROR', message: e.message });
      }
    }

    // POST /guilds/:id/badge  { playerId, badge } -> leader buys+sets a badge for 5000✦
    if (req.method === 'POST' && pathname.match(/^\/guilds\/\d+\/badge$/)) {
      const guildId = Number(pathname.split('/')[2]);
      const { playerId, badge } = await readBody(req);
      try {
        const result = db.buyGuildBadge(playerId, guildId, badge);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // POST /guilds/:id/notice  { playerId, notice }
    if (req.method === 'POST' && pathname.match(/^\/guilds\/\d+\/notice$/)) {
      const guildId = Number(pathname.split('/')[2]);
      const { playerId, notice } = await readBody(req);
      try {
        const guild = db.setGuildNotice(playerId, guildId, notice);
        return sendJson(res, 200, { guild });
      } catch (e) {
        return sendJson(res, 409, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // GET /guilds/:id/leaderboard
    if (req.method === 'GET' && pathname.match(/^\/guilds\/\d+\/leaderboard$/)) {
      const guildId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, { leaderboard: db.getGuildLeaderboard(guildId) });
      } catch (e) {
        return sendJson(res, 404, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // POST /guilds/leave  { playerId }
    if (req.method === 'POST' && pathname === '/guilds/leave') {
      const { playerId } = await readBody(req);
      try {
        const guild = db.leaveGuild(playerId);
        return sendJson(res, 200, { guild });
      } catch (e) {
        return sendJson(res, 409, { error: 'GUILD_ERROR', message: e.message });
      }
    }

    // POST /redeem  { playerId, code }
    if (req.method === 'POST' && pathname === '/redeem') {
      const { playerId, code } = await readBody(req);
      try {
        const result = db.redeemCodeFn(playerId, code);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'REDEEM_ERROR', message: e.message });
      }
    }

    // POST /redeem-codes  { code, rewardCrystals?, rewardSpeciesId?, maxUses?, adminCode }
    // Admin-only — see ADMIN_CODES above.
    if (req.method === 'POST' && pathname === '/redeem-codes') {
      const body = await readBody(req);
      if (body.adminCode !== ADMIN_CODES.redeemCodes) {
        return sendJson(res, 403, { error: 'ADMIN_ONLY', message: 'Chris Admin Only — no access' });
      }
      try {
        if (!body.code) throw new Error('code required');
        const row = db.createRedeemCode(body);
        return sendJson(res, 201, { code: row });
      } catch (e) {
        return sendJson(res, 400, { error: 'REDEEM_CODE_ERROR', message: e.message });
      }
    }

    // POST /admin/validate-code  { adminCode } -> validation only, no side effects
    if (req.method === 'POST' && pathname === '/admin/validate-code') {
      const { adminCode } = await readBody(req);
      return sendJson(res, 200, { valid: adminCode === ADMIN_CODES.events });
    }

    // POST /admin/players  { adminCode } -> lists every player with last-online, for account cleanup
    if (req.method === 'POST' && pathname === '/admin/players') {
      const { adminCode } = await readBody(req);
      if (adminCode !== ADMIN_CODES.events) {
        return sendJson(res, 403, { error: 'ADMIN_ONLY', message: 'Chris Admin Only — no access' });
      }
      return sendJson(res, 200, { players: db.listPlayersAdmin() });
    }

    // POST /friends/request  { fromPlayerId, toPlayerId }
    if (req.method === 'POST' && pathname === '/friends/request') {
      const { fromPlayerId, toPlayerId } = await readBody(req);
      try {
        const result = db.sendFriendRequest(fromPlayerId, toPlayerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'FRIEND_ERROR', message: e.message });
      }
    }

    // POST /friends/accept  { playerId, fromPlayerId }
    if (req.method === 'POST' && pathname === '/friends/accept') {
      const { playerId, fromPlayerId } = await readBody(req);
      try {
        const result = db.acceptFriendRequest(playerId, fromPlayerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'FRIEND_ERROR', message: e.message });
      }
    }

    // POST /friends/decline  { playerId, fromPlayerId }
    if (req.method === 'POST' && pathname === '/friends/decline') {
      const { playerId, fromPlayerId } = await readBody(req);
      try {
        const result = db.declineFriendRequest(playerId, fromPlayerId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'FRIEND_ERROR', message: e.message });
      }
    }

    // GET /friends/:playerId
    if (req.method === 'GET' && pathname.match(/^\/friends\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, db.getFriendsData(playerId));
      } catch (e) {
        return sendJson(res, 404, { error: 'NOT_FOUND', message: e.message });
      }
    }

    // POST /admin/players/:id/reset-pin  { adminCode, newPin }
    if (req.method === 'POST' && pathname.match(/^\/admin\/players\/\d+\/reset-pin$/)) {
      const playerId = Number(pathname.split('/')[3]);
      const body = await readBody(req);
      if (body.adminCode !== ADMIN_CODES.events) {
        return sendJson(res, 403, { error: 'ADMIN_ONLY', message: 'Chris Admin Only — no access' });
      }
      try {
        const result = db.adminResetPin(playerId, body.newPin);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'RESET_ERROR', message: e.message });
      }
    }

    // POST /admin/players/:id/delete  { adminCode } -> cascading delete
    if (req.method === 'POST' && pathname.match(/^\/admin\/players\/\d+\/delete$/)) {
      const targetId = Number(pathname.split('/')[3]);
      const { adminCode } = await readBody(req);
      if (adminCode !== ADMIN_CODES.events) {
        return sendJson(res, 403, { error: 'ADMIN_ONLY', message: 'Chris Admin Only — no access' });
      }
      try {
        const result = db.deletePlayerAdmin(targetId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 404, { error: 'ADMIN_ERROR', message: e.message });
      }
    }

    // GET /events -> currently active time-exclusive events
    if (req.method === 'GET' && pathname === '/events') {
      return sendJson(res, 200, { events: db.listActiveEvents() });
    }

    // POST /events  { name, mode? ('boost'|'grant'), speciesIds?, collection?, spawnWeightMultiplier?, grantWeights?, startTime, endTime, adminCode }
    // Admin-only — see ADMIN_CODES above.
    if (req.method === 'POST' && pathname === '/events') {
      const body = await readBody(req);
      if (body.adminCode !== ADMIN_CODES.events) {
        return sendJson(res, 403, { error: 'ADMIN_ONLY', message: 'Chris Admin Only — no access' });
      }
      try {
        const event = db.createEvent(body);
        return sendJson(res, 201, { event });
      } catch (e) {
        return sendJson(res, 400, { error: 'EVENT_ERROR', message: e.message });
      }
    }

    // ---- REAL-TIME STREAM (SSE) ----
    // GET /stream?playerId=N — long-lived. Do NOT wrap this in the
    // normal sendJson path; the response deliberately stays open.
    if (req.method === 'GET' && pathname === '/stream') {
      const playerId = Number(searchParams.get('playerId'));
      if (!playerId || !db.players.get(playerId)) {
        return sendJson(res, 400, { error: 'NO_PLAYER', message: 'Valid playerId required' });
      }
      realtimeModule.subscribe(playerId, res);
      return; // connection stays open
    }

    // GET /stream/stats -> how many players/connections are live
    if (req.method === 'GET' && pathname === '/stream/stats') {
      return sendJson(res, 200, realtimeModule.stats());
    }

    // ---- LIVE PVP ----
    // GET /livepvp/:playerId -> lobby: who's online, challenges, current battle
    if (req.method === 'GET' && pathname.match(/^\/livepvp\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, livepvpModule.lobbyFor(playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // GET /livepvp/room/:roomId?playerId=N
    if (req.method === 'GET' && pathname.match(/^\/livepvp\/room\/\d+$/)) {
      const roomId = Number(pathname.split('/')[3]);
      const playerId = Number(searchParams.get('playerId'));
      try {
        return sendJson(res, 200, livepvpModule.roomView(roomId, playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // POST /livepvp/challenge { fromPlayerId, toPlayerId, teamDroidIds }
    if (req.method === 'POST' && pathname === '/livepvp/challenge') {
      const { fromPlayerId, toPlayerId, teamDroidIds } = await readBody(req);
      presenceModule.touch(fromPlayerId);
      try {
        const ch = livepvpModule.challenge(fromPlayerId, toPlayerId, teamDroidIds);
        return sendJson(res, 201, { challengeId: ch.id, expiresAt: ch.expiresAt });
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // POST /livepvp/accept { challengeId, playerId, teamDroidIds }
    if (req.method === 'POST' && pathname === '/livepvp/accept') {
      const { challengeId, playerId, teamDroidIds } = await readBody(req);
      presenceModule.touch(playerId);
      try {
        const room = livepvpModule.acceptChallenge(challengeId, playerId, teamDroidIds);
        return sendJson(res, 200, livepvpModule.roomView(room.id, playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // POST /livepvp/decline { challengeId, playerId }
    if (req.method === 'POST' && pathname === '/livepvp/decline') {
      const { challengeId, playerId } = await readBody(req);
      try {
        return sendJson(res, 200, livepvpModule.declineChallenge(challengeId, playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // POST /livepvp/attack { roomId, playerId }
    if (req.method === 'POST' && pathname === '/livepvp/attack') {
      const { roomId, playerId } = await readBody(req);
      presenceModule.touch(playerId);
      try {
        const r = livepvpModule.attack(roomId, playerId);
        return sendJson(res, 200, livepvpModule.roomView(r.room.id, playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // POST /livepvp/forfeit { roomId, playerId }
    if (req.method === 'POST' && pathname === '/livepvp/forfeit') {
      const { roomId, playerId } = await readBody(req);
      try {
        const r = livepvpModule.forfeit(roomId, playerId);
        return sendJson(res, 200, livepvpModule.roomView(r.room.id, playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LIVE_PVP_ERROR', message: e.message });
      }
    }

    // GET /presence/:playerId -> that player's status
    if (req.method === 'GET' && pathname.match(/^\/presence\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      return sendJson(res, 200, {
        playerId,
        presence: presenceModule.statusOf(playerId),
        online: presenceModule.isOnline(playerId),
        lastSeenText: presenceModule.lastSeenText(playerId),
      });
    }

    // POST /presence/heartbeat { playerId }
    // Explicit keep-alive for a client sitting on a screen that makes
    // no other requests, so presence doesn't go stale while someone is
    // clearly still there.
    if (req.method === 'POST' && pathname === '/presence/heartbeat') {
      const { playerId } = await readBody(req);
      presenceModule.touch(playerId);
      return sendJson(res, 200, { ok: true, presence: presenceModule.statusOf(playerId) });
    }

    // ---- COSMETICS ----
    // GET /cosmetics2/:playerId -> sets, ownership, equipped, totals
    // (named cosmetics2 to avoid colliding with the existing /cosmetics
    //  catalogue route from the original build)
    if (req.method === 'GET' && pathname.match(/^\/cosmetics2\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, cosmeticsModule.summaryFor(playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'COSMETIC_ERROR', message: e.message });
      }
    }

    // POST /cosmetics2/equip { playerId, pieceId }
    if (req.method === 'POST' && pathname === '/cosmetics2/equip') {
      const { playerId, pieceId } = await readBody(req);
      try {
        const r = cosmeticsModule.equip(playerId, pieceId);
        return sendJson(res, 200, { ...r, summary: cosmeticsModule.summaryFor(playerId) });
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'COSMETIC_ERROR', message: e.message });
      }
    }

    // POST /cosmetics2/unequip { playerId, slot }
    if (req.method === 'POST' && pathname === '/cosmetics2/unequip') {
      const { playerId, slot } = await readBody(req);
      try {
        const r = cosmeticsModule.unequip(playerId, slot);
        return sendJson(res, 200, { ...r, summary: cosmeticsModule.summaryFor(playerId) });
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'COSMETIC_ERROR', message: e.message });
      }
    }

    // ---- DROID ATTACHMENTS ----
    // GET /attachments/:playerId -> catalog + what they own
    if (req.method === 'GET' && pathname.match(/^\/attachments\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, attachmentsModule.summaryFor(playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'ATTACHMENT_ERROR', message: e.message });
      }
    }

    // POST /attachments/equip { playerId, droidId, attachmentId }
    if (req.method === 'POST' && pathname === '/attachments/equip') {
      const { playerId, droidId, attachmentId } = await readBody(req);
      try {
        const r = attachmentsModule.equip(playerId, droidId, attachmentId);
        return sendJson(res, 200, { droid: workshopModule.enrichDroid(r.droid), slot: r.slot, replaced: r.replaced });
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'ATTACHMENT_ERROR', message: e.message });
      }
    }

    // POST /attachments/unequip { playerId, droidId, slot }
    if (req.method === 'POST' && pathname === '/attachments/unequip') {
      const { playerId, droidId, slot } = await readBody(req);
      try {
        const r = attachmentsModule.unequip(playerId, droidId, slot);
        return sendJson(res, 200, { droid: workshopModule.enrichDroid(r.droid), slot: r.slot, removed: r.removed });
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'ATTACHMENT_ERROR', message: e.message });
      }
    }

    // ---- PLAYER LEVELS / RE-BOOT ----
    // GET /levels/:playerId
    if (req.method === 'GET' && pathname.match(/^\/levels\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, levelsModule.statusFor(playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LEVEL_ERROR', message: e.message });
      }
    }

    // POST /levels/reboot { playerId, confirm: true }
    // Destructive and irreversible — requires an explicit confirm flag
    // so a mis-fired request can never wipe an account.
    if (req.method === 'POST' && pathname === '/levels/reboot') {
      const { playerId, confirm } = await readBody(req);
      try {
        return sendJson(res, 200, levelsModule.reboot(playerId, confirm === true));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'LEVEL_ERROR', message: e.message });
      }
    }

    // GET /buffs/:playerId -> full breakdown of every active buff,
    // which source each came from, and which are capped out.
    if (req.method === 'GET' && pathname.match(/^\/buffs\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      const player = db.players.get(playerId);
      if (!player) return sendJson(res, 404, { error: 'NO_PLAYER', message: 'Player not found' });
      return sendJson(res, 200, buffsModule.breakdownFor(player));
    }

    // ---- JOY STICK ----
    // Every one of these is server-authoritative: the client proposes,
    // joystick.js decides. See the security note at the top of that file.

    // GET /joystick/:playerId -> current session + cooldown + balances
    if (req.method === 'GET' && pathname.match(/^\/joystick\/\d+$/)) {
      const playerId = Number(pathname.split('/')[2]);
      try {
        return sendJson(res, 200, joystickModule.statusFor(playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'JOYSTICK_ERROR', message: e.message });
      }
    }

    // POST /joystick/activate { playerId, tokens, lat, lng }
    if (req.method === 'POST' && pathname === '/joystick/activate') {
      const { playerId, tokens, lat, lng } = await readBody(req);
      try {
        return sendJson(res, 200, joystickModule.activate(playerId, tokens, Number(lat), Number(lng)));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'JOYSTICK_ERROR', message: e.message });
      }
    }

    // POST /joystick/move { playerId, lat, lng }
    if (req.method === 'POST' && pathname === '/joystick/move') {
      const { playerId, lat, lng } = await readBody(req);
      try {
        return sendJson(res, 200, joystickModule.move(playerId, Number(lat), Number(lng)));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'JOYSTICK_ERROR', message: e.message });
      }
    }

    // POST /joystick/pulse { playerId }
    if (req.method === 'POST' && pathname === '/joystick/pulse') {
      const { playerId } = await readBody(req);
      try {
        return sendJson(res, 200, joystickModule.pulse(playerId, spawnsModule));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'JOYSTICK_ERROR', message: e.message });
      }
    }

    // POST /joystick/end { playerId }  -> return to real location, start cooldown
    if (req.method === 'POST' && pathname === '/joystick/end') {
      const { playerId } = await readBody(req);
      try {
        return sendJson(res, 200, joystickModule.acknowledgeExpiry(playerId));
      } catch (e) {
        return sendJson(res, 400, { error: e.code || 'JOYSTICK_ERROR', message: e.message });
      }
    }

    // POST /events/apex-hunt  { adminCode, durationMs? }
    // One-button launch for the 30-minute Apex Hunt. Admin-only, same
    // gate as /events — this is the only thing in the game that makes
    // Apex droids spawnable at all.
    if (req.method === 'POST' && pathname === '/events/apex-hunt') {
      const body = await readBody(req);
      if (body.adminCode !== ADMIN_CODES.events) {
        return sendJson(res, 403, { error: 'ADMIN_ONLY', message: 'Chris Admin Only — no access' });
      }
      try {
        const event = db.createApexHuntEvent({ durationMs: body.durationMs || db.APEX_HUNT_DURATION_MS });
        return sendJson(res, 201, { event, apexSpeciesCount: db.apexSpeciesList().length });
      } catch (e) {
        return sendJson(res, 400, { error: 'EVENT_ERROR', message: e.message });
      }
    }

    // POST /trades  { fromPlayerId, toPlayerId, offeredDroidIds, offeredCrystals, offeredMaterials, requestedDroidIds, requestedCrystals, requestedMaterials }
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

    // GET /wishlist -> public board of active (unfulfilled) wishes
    if (req.method === 'GET' && pathname === '/wishlist') {
      return sendJson(res, 200, { wishes: db.listWishes(true) });
    }

    // POST /wishlist  { playerId, wishType, speciesId?, variantWanted?, colorWanted?, note? }
    if (req.method === 'POST' && pathname === '/wishlist') {
      const { playerId, ...opts } = await readBody(req);
      try {
        const wish = db.createWish(playerId, opts);
        return sendJson(res, 201, { wish });
      } catch (e) {
        return sendJson(res, 400, { error: 'WISH_ERROR', message: e.message });
      }
    }

    // POST /wishlist/:id/cancel  { playerId }
    if (req.method === 'POST' && pathname.match(/^\/wishlist\/\d+\/cancel$/)) {
      const wishId = Number(pathname.split('/')[2]);
      const { playerId } = await readBody(req);
      try {
        const result = db.cancelWish(playerId, wishId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 409, { error: 'WISH_ERROR', message: e.message });
      }
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: 'internal_error', message: err.message });
  }
});

persistence.load().then(() => {
  db.seedStarterRedeemCodes();
  server.listen(PORT, () => {
    console.log(`Sparkfield backend running on http://localhost:${PORT}`);
    persistence.startAutoSave();
    persistence.registerShutdownHook();
    // Drives live PVP turn countdowns and challenge expiry.
    livepvpModule.startTicker();
  });
});

module.exports = server;
