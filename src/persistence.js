// persistence.js
//
// Optional durable persistence via Upstash Redis's HTTP REST API, called
// with plain fetch (built into Node 18+) — no extra npm package, keeping
// this project's zero-dependency design.
//
// If UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN aren't set in the
// environment, every function here silently no-ops and the server behaves
// exactly as before (in-memory only) — so local dev needs zero setup.
//
// Why Upstash specifically: most free hosts (Render's free tier included)
// have an EPHEMERAL filesystem — local files don't survive a redeploy or
// a spin-down/wake cycle. Upstash's data lives outside the app process
// entirely, over plain HTTPS, so it survives exactly the kind of restart
// that would otherwise wipe tester progress.

const db = require('./db');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED = Boolean(REDIS_URL && REDIS_TOKEN);

const SNAPSHOT_KEY = 'droid-catcher:snapshot';
const SAVE_INTERVAL_MS = 30 * 1000;

async function redisCommand(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.result;
}

async function save() {
  if (!ENABLED) return;
  try {
    const snapshot = JSON.stringify(db.exportState());
    await redisCommand(['SET', SNAPSHOT_KEY, snapshot]);
  } catch (e) {
    console.error('Persistence save failed (continuing in-memory):', e.message);
  }
}

async function load() {
  if (!ENABLED) {
    console.log('Persistence disabled (no UPSTASH_REDIS_REST_URL/TOKEN set) — running in-memory only.');
    return;
  }
  try {
    const raw = await redisCommand(['GET', SNAPSHOT_KEY]);
    if (raw) {
      db.importState(JSON.parse(raw));
      console.log('Loaded saved game state from Upstash.');
    } else {
      console.log('No saved game state found in Upstash — starting fresh.');
    }
  } catch (e) {
    console.error('Persistence load failed, starting fresh:', e.message);
  }
}

function startAutoSave() {
  if (!ENABLED) return;
  setInterval(save, SAVE_INTERVAL_MS);
  console.log(`Auto-save enabled — saving every ${SAVE_INTERVAL_MS / 1000}s.`);
}

// Best-effort final save on shutdown (most hosts send SIGTERM before
// killing the process on redeploy/spin-down) — narrows the data-loss
// window to whatever happens between the last periodic save and a crash,
// rather than always losing up to SAVE_INTERVAL_MS of progress.
function registerShutdownHook() {
  if (!ENABLED) return;
  const handler = async () => {
    console.log('Shutting down — saving final state...');
    await save();
    process.exit(0);
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

module.exports = { save, load, startAutoSave, registerShutdownHook, ENABLED };
