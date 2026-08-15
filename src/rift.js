// rift.js
//
// SPACE RIFT — a self-contained tile-exploration mission mode.
//
// THE ARCHITECTURAL DECISION THAT SHAPES EVERYTHING
// A 150x150 grid is 22,500 cells. Serialised into the Upstash snapshot
// that is roughly 66KB PER PLAYER PER MISSION — against a current whole-
// game snapshot of about 3KB. Storing the grid would grow the save by
// twentyfold for one feature.
//
// So the map is NEVER stored. We store the SEED plus a small set of
// deltas (which chests are open, which bosses are dead, where the player
// is). generate(seed) is fully deterministic, so the identical map is
// rebuilt on demand, on any server, forever. A mission in progress costs
// a few hundred bytes.
//
// This also gives the spec's "map seed so missions can be reproduced for
// debugging and QA" for free — the seed IS the map.
//
// RENDERING
// The client never receives 22,500 cells either. viewportFor() returns
// only the cells around the player (default 15x15), so a phone renders
// ~225 tiles per move instead of the whole grid.

const db = require('./db');

// ---- constants ----
const MAP_W = 150;
const MAP_H = 150;
const VIEW_RADIUS = 7;          // 15x15 viewport
const TEAM_SIZE = 6;
const RIFT_ENTRY_CUBES = 1;   // cost to start a Space Rift mission
const RIFT_FLAG_COUNT = 10;   // markers a player can drop per mission
const EARLY_EXTRACT_PENALTY = 0.20; // material loot lost when extracting before all bosses are down
const REQUIRED_BOSSES = 5;
const CHEST_COUNT = 10;
const DEBRIS_COUNT = 24;
const CRYSTAL_COUNT = 18;
const HEALING_POST_COUNT = 4;
const MAX_HEALING_USES = 5;     // total across the whole mission
const SCENERY_COUNT = 90;
const WILD_ENCOUNTER_CHANCE = 0.055; // per step on open floor

// Tile codes kept as single characters so a viewport row is a compact
// string rather than an array of objects.
const T = {
  FLOOR: '.',
  WALL: '#',
  START: 'S',
  EXIT: 'E',
};

// ---- deterministic PRNG ----
// mulberry32: small, fast, and identical across every JS engine, which
// is what makes seed-based regeneration trustworthy.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- content tables ----
const BOSSES = [
  { id: 'rift_overlord', name: 'Rift Overlord', move: 'Void Pulse', hp: 650, attack: 70, alignment: 'dark' },
  { id: 'celestial_sentinel', name: 'Celestial Sentinel', move: 'Light Judgment', hp: 720, attack: 65, alignment: 'light' },
  { id: 'shadow_titan', name: 'Shadow Titan', move: 'Dark Annihilation', hp: 850, attack: 80, alignment: 'dark' },
  { id: 'rift_warden', name: 'Rift Warden', move: 'Reality Shatter', hp: 1000, attack: 90, alignment: 'dark' },
  { id: 'storm_crown', name: 'Storm Crown', move: 'Tempest Strike', hp: 1250, attack: 105, alignment: 'light' },
  // --- Second boss set ---
  { id: 'the_voidfang', name: 'The Voidfang', move: 'Null Pulse', hp: 700, attack: 72, alignment: 'dark' },
  { id: 'lumen_guardian', name: 'Lumen Guardian', move: 'Solar Lance', hp: 780, attack: 68, alignment: 'light' },
  { id: 'rift_behemoth', name: 'Rift Behemoth', move: 'Meteor Strike', hp: 900, attack: 85, alignment: 'dark' },
  { id: 'the_nexus_queen', name: 'The Nexus Queen', move: 'Mind Siphon', hp: 1050, attack: 95, alignment: 'dark' },
  { id: 'stellar_sentinel', name: 'Stellar Sentinel', move: 'Gravity Crush', hp: 1300, attack: 110, alignment: 'light' },
];

const RIFT_DROIDS = [
  { id: 'void_scout', name: 'Void Scout', rarity: 'common', move: 'Shadow Blast', hp: 60, attack: 12, alignment: 'dark' },
  { id: 'rift_hound', name: 'Rift Hound', rarity: 'common', move: 'Bite Rush', hp: 70, attack: 14, alignment: 'dark' },
  { id: 'spark_drone', name: 'Spark Drone', rarity: 'common', move: 'Light Spark', hp: 55, attack: 13, alignment: 'light' },
  { id: 'storm_mite', name: 'Storm Mite', rarity: 'common', move: 'Static Field', hp: 50, attack: 15, alignment: 'light' },
  { id: 'rift_rat', name: 'Rift Rat', rarity: 'common', move: 'Quick Strike', hp: 45, attack: 16, alignment: 'dark' },
  { id: 'lumen_guard', name: 'Lumen Guard', rarity: 'uncommon', move: 'Healing Light', hp: 130, attack: 20, alignment: 'light' },
  { id: 'nexus_beast', name: 'Nexus Beast', rarity: 'uncommon', move: 'Void Charge', hp: 145, attack: 24, alignment: 'dark' },
  { id: 'aqua_sentinel', name: 'Aqua Sentinel', rarity: 'uncommon', move: 'Tidal Burst', hp: 140, attack: 22, alignment: 'light' },
  { id: 'photon_wisp', name: 'Photon Wisp', rarity: 'uncommon', move: 'Energy Lash', hp: 110, attack: 26, alignment: 'light' },
  { id: 'rift_stalker', name: 'Rift Stalker', rarity: 'uncommon', move: 'Dark Lunge', hp: 135, attack: 25, alignment: 'dark' },
  { id: 'celestial_lion', name: 'Celestial Lion', rarity: 'rare', move: 'Solar Roar', hp: 260, attack: 40, alignment: 'light' },
  { id: 'obsidian_serpent', name: 'Obsidian Serpent', rarity: 'rare', move: 'Poison Nova', hp: 250, attack: 42, alignment: 'dark' },
  { id: 'stellar_phoenix', name: 'Stellar Phoenix', rarity: 'rare', move: 'Nova Rise', hp: 240, attack: 45, alignment: 'light' },
  { id: 'gravity_titan', name: 'Gravity Titan', rarity: 'rare', move: 'Gravity Wave', hp: 300, attack: 38, alignment: 'dark' },
  { id: 'eclipse_prime', name: 'Eclipse Prime', rarity: 'legendary', move: 'Paradox Strike', hp: 520, attack: 65, alignment: 'dark' },
  // --- Second droid set ---
  { id: 'rift_relay', name: 'Rift Relay', rarity: 'common', move: 'Pulse Burst', hp: 58, attack: 13, alignment: 'light' },
  { id: 'void_hopper', name: 'Void Hopper', rarity: 'common', move: 'Shadow Leap', hp: 52, attack: 15, alignment: 'dark' },
  { id: 'fracture_bug', name: 'Fracture Bug', rarity: 'common', move: 'Piercing Sting', hp: 48, attack: 16, alignment: 'dark' },
  { id: 'rift_scout', name: 'Rift Scout', rarity: 'common', move: 'Disrupt Wave', hp: 65, attack: 12, alignment: 'light' },
  { id: 'lumina_pixie', name: 'Lumina Pixie', rarity: 'common', move: 'Light Burst', hp: 50, attack: 14, alignment: 'light' },
  { id: 'obsidian_stalker', name: 'Obsidian Stalker', rarity: 'uncommon', move: 'Shadow Pounce', hp: 138, attack: 25, alignment: 'dark' },
  { id: 'rift_crusher', name: 'Rift Crusher', rarity: 'uncommon', move: 'Core Slam', hp: 155, attack: 21, alignment: 'dark' },
  { id: 'sky_vortex', name: 'Sky Vortex', rarity: 'uncommon', move: 'Vortex Pull', hp: 120, attack: 27, alignment: 'light' },
  { id: 'solaris_wasp', name: 'Solaris Wasp', rarity: 'uncommon', move: 'Sting Storm', hp: 115, attack: 28, alignment: 'light' },
  { id: 'abyss_drake', name: 'Abyss Drake', rarity: 'uncommon', move: 'Void Breath', hp: 150, attack: 23, alignment: 'dark' },
  { id: 'celestial_knight', name: 'Celestial Knight', rarity: 'rare', move: 'Nova Slash', hp: 270, attack: 43, alignment: 'light' },
  { id: 'rift_phoenix', name: 'Rift Phoenix', rarity: 'rare', move: 'Solar Flare', hp: 245, attack: 46, alignment: 'light' },
  { id: 'titan_charger', name: 'Titan Charger', rarity: 'rare', move: 'Rift Rush', hp: 310, attack: 39, alignment: 'dark' },
  { id: 'echo_sentinel', name: 'Echo Sentinel', rarity: 'rare', move: 'Reality Shift', hp: 255, attack: 44, alignment: 'light' },
  { id: 'singularity_core', name: 'Singularity Core', rarity: 'legendary', move: 'Quantum Storm', hp: 540, attack: 68, alignment: 'light' },
  // --- Rift Guardians (light) / Riftborn (dark) ---
  { id: 'aetherion', name: 'Aetherion', rarity: 'rare', move: 'Celestial Roar', hp: 285, attack: 45, alignment: 'light' },
  { id: 'solaryx', name: 'Solaryx', rarity: 'rare', move: 'Solar Rebirth', hp: 260, attack: 48, alignment: 'light' },
  { id: 'luminarc', name: 'Luminarc', rarity: 'rare', move: 'Radiant Charge', hp: 300, attack: 42, alignment: 'light' },
  { id: 'abyssara', name: 'Abyssara', rarity: 'legendary', move: 'Tidal Abyss', hp: 560, attack: 66, alignment: 'light' },
  { id: 'drakoryn', name: 'Drakoryn', rarity: 'legendary', move: 'Astral Breath', hp: 530, attack: 72, alignment: 'light' },
  { id: 'voidfang', name: 'Voidfang', rarity: 'rare', move: 'Shadow Maul', hp: 270, attack: 47, alignment: 'dark' },
  { id: 'gravemaw', name: 'Gravemaw', rarity: 'rare', move: 'Web Collapse', hp: 290, attack: 44, alignment: 'dark' },
  { id: 'nexulon', name: 'Nexulon', rarity: 'rare', move: 'Void Coil', hp: 275, attack: 46, alignment: 'dark' },
  { id: 'dreadhorn', name: 'Dreadhorn', rarity: 'legendary', move: 'Ruin Charge', hp: 580, attack: 64, alignment: 'dark' },
  { id: 'malivex', name: 'Malivex', rarity: 'legendary', move: 'Dread Descent', hp: 540, attack: 70, alignment: 'dark' },
];
const DROID_BY_ID = {};
RIFT_DROIDS.forEach((d) => { DROID_BY_ID[d.id] = d; });

const SCENERY_KINDS = ['rock', 'blackhole', 'riftstrike'];

class RiftError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Rift Scanner tier (Fort L9+) improves Rift loot for the whole guild.
// Reads the player's guild Forts; any one qualifying is enough.
function riftLootMultiplier(playerId) {
  try {
    const player = db.players.get(playerId);
    if (!player || !player.guildId) return 1;
    const forts = require('./forts');
    const owned = [...forts.forts.values()].filter((f) => f.guildId === player.guildId);
    return owned.some((f) => forts.fortHas(f, 'riftBonus')) ? 1.25 : 1;
  } catch (e) { return 1; }
}

// ============================================================
// MAP GENERATION
// ============================================================
//
// Rooms-and-corridors rather than pure noise, because the spec demands
// MULTIPLE viable routes and guaranteed reachability. A cave-style
// generator gives neither without expensive repair passes.
//
// Every corridor is carved 2 cells wide, so a wall tile can never
// pinch a route down to nothing.

function generate(seed) {
  const rand = mulberry32(seed);
  const grid = new Uint8Array(MAP_W * MAP_H); // 0 = wall, 1 = floor
  const idx = (x, y) => y * MAP_W + x;

  const carveRect = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x > 0 && y > 0 && x < MAP_W - 1 && y < MAP_H - 1) grid[idx(x, y)] = 1;
      }
    }
  };

  // ---- rooms ----
  const rooms = [];
  const ROOM_TRIES = 150;
  for (let i = 0; i < ROOM_TRIES; i++) {
    const w = 6 + Math.floor(rand() * 14);
    const h = 6 + Math.floor(rand() * 14);
    const x = 2 + Math.floor(rand() * (MAP_W - w - 4));
    const y = 2 + Math.floor(rand() * (MAP_H - h - 4));
    // Allow slight overlap: it produces more interesting shapes and more
    // ways through than strictly separated rooms.
    const overlapping = rooms.some((r) =>
      x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y);
    if (overlapping && rooms.length > 4 && rand() > 0.25) continue;
    carveRect(x, y, w, h);
    rooms.push({ x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
    if (rooms.length >= 40) break;
  }

  // ---- corridors ----
  const connect = (a, b) => {
    let x = a.cx; let y = a.cy;
    const horizFirst = rand() > 0.5;
    const stepX = () => { while (x !== b.cx) { x += x < b.cx ? 1 : -1; carveRect(x, y, 1, 2); } };
    const stepY = () => { while (y !== b.cy) { y += y < b.cy ? 1 : -1; carveRect(x, y, 2, 1); } };
    if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  };

  // Chain them, then add extra links so the map is a NETWORK rather than
  // a tree — a tree has exactly one route between any two points, which
  // is precisely what the spec rules out.
  for (let i = 1; i < rooms.length; i++) connect(rooms[i - 1], rooms[i]);
  const extraLinks = Math.floor(rooms.length * 0.6);
  for (let i = 0; i < extraLinks; i++) {
    const a = rooms[Math.floor(rand() * rooms.length)];
    const b = rooms[Math.floor(rand() * rooms.length)];
    if (a !== b) connect(a, b);
  }

  // ---- border ----
  for (let x = 0; x < MAP_W; x++) { grid[idx(x, 0)] = 0; grid[idx(x, MAP_H - 1)] = 0; }
  for (let y = 0; y < MAP_H; y++) { grid[idx(0, y)] = 0; grid[idx(MAP_W - 1, y)] = 0; }

  // ---- start and exit ----
  const nearestFloor = (tx, ty) => {
    let best = null; let bestD = Infinity;
    for (const r of rooms) {
      const d = Math.abs(r.cx - tx) + Math.abs(r.cy - ty);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best ? { x: best.cx, y: best.cy } : { x: 2, y: 2 };
  };
  const start = nearestFloor(8, MAP_H - 9);   // bottom-left
  const exit = nearestFloor(MAP_W - 9, 8);    // top-right

  return { seed, grid, rooms, start, exit };
}

// Reachability + route-count check. Run at generation time so a bad
// layout is rejected rather than shipped to a player who then can't
// finish it.
function floodReachable(grid, from) {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const q = [from];
  seen[from.y * MAP_W + from.x] = 1;
  let count = 0;
  while (q.length) {
    const c = q.pop();
    count++;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx; const ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const i = ny * MAP_W + nx;
      if (seen[i] || !grid[i]) continue;
      seen[i] = 1;
      q.push({ x: nx, y: ny });
    }
  }
  return { seen, count };
}

// Places everything that isn't terrain. Deterministic from the same
// seed, so this runs on regeneration too and produces identical results.
function populate(map) {
  const rand = mulberry32(map.seed ^ 0x9e3779b9);
  const { grid } = map;
  const { seen } = floodReachable(grid, map.start);
  const taken = new Set();
  const key = (x, y) => `${x},${y}`;
  taken.add(key(map.start.x, map.start.y));
  taken.add(key(map.exit.x, map.exit.y));

  const randomFloor = (opts = {}) => {
    for (let tries = 0; tries < 4000; tries++) {
      const x = 1 + Math.floor(rand() * (MAP_W - 2));
      const y = 1 + Math.floor(rand() * (MAP_H - 2));
      const i = y * MAP_W + x;
      if (!grid[i] || !seen[i]) continue;          // must be reachable floor
      if (taken.has(key(x, y))) continue;
      if (opts.minFromStart) {
        const d = Math.abs(x - map.start.x) + Math.abs(y - map.start.y);
        if (d < opts.minFromStart) continue;
      }
      taken.add(key(x, y));
      return { x, y };
    }
    return null;
  };

  // Bosses are spread by distance from start so they act as a
  // progression backbone rather than clustering in one corner.
  const bosses = [];
  const maxDist = MAP_W + MAP_H;
  // There are more bosses defined than any single run uses, so each run
  // draws REQUIRED_BOSSES of them from the seeded RNG — different lineup
  // per mission, still deterministic for a given seed.
  const bossPool = BOSSES.slice();
  const chosenBosses = [];
  while (chosenBosses.length < REQUIRED_BOSSES && bossPool.length) {
    chosenBosses.push(bossPool.splice(Math.floor(rand() * bossPool.length), 1)[0]);
  }
  chosenBosses.forEach((b, i) => {
    const band = Math.floor((maxDist * 0.25) + (i * maxDist * 0.11));
    let pos = null;
    for (let tries = 0; tries < 1200 && !pos; tries++) {
      const p = randomFloor();
      if (!p) break;
      const d = Math.abs(p.x - map.start.x) + Math.abs(p.y - map.start.y);
      if (Math.abs(d - band) < 28) pos = p;
      else taken.delete(key(p.x, p.y));
    }
    if (!pos) pos = randomFloor({ minFromStart: 20 });
    if (pos) bosses.push({ ...b, x: pos.x, y: pos.y, index: i });
  });

  const place = (n, maker, opts) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = randomFloor(opts);
      if (p) out.push(maker(p, i));
    }
    return out;
  };

  const chests = place(CHEST_COUNT, (p, i) => ({ id: `chest${i}`, ...p }), { minFromStart: 12 });
  const debris = place(DEBRIS_COUNT, (p, i) => ({ id: `debris${i}`, ...p }));
  const crystals = place(CRYSTAL_COUNT, (p, i) => ({ id: `crystal${i}`, ...p }));
  const healing = place(HEALING_POST_COUNT, (p, i) => ({ id: `heal${i}`, ...p }), { minFromStart: 25 });
  const scenery = place(SCENERY_COUNT, (p, i) => ({
    id: `scn${i}`, ...p, kind: SCENERY_KINDS[Math.floor(rand() * SCENERY_KINDS.length)],
  }));

  return { ...map, bosses, chests, debris, crystals, healing, scenery, reachable: seen };
}

// Cached so a burst of moves doesn't regenerate 22,500 cells each time.
// Keyed by seed; a handful of live missions is a handful of entries.
const mapCache = new Map();
function buildMap(seed) {
  if (mapCache.has(seed)) return mapCache.get(seed);
  let map = generate(seed);
  // Validate: the exit must be reachable, and enough of the map with it.
  let guard = 0;
  while (guard++ < 12) {
    const { seen, count } = floodReachable(map.grid, map.start);
    const exitOk = seen[map.exit.y * MAP_W + map.exit.x] === 1;
    if (exitOk && count > 2500) break;
    map = generate(seed + guard * 7919);
  }
  const full = populate(map);
  if (mapCache.size > 40) mapCache.clear();
  mapCache.set(seed, full);
  return full;
}

// ============================================================
// MISSION LIFECYCLE
// ============================================================

function activeMission(player) {
  const m = player.riftMission;
  if (!m || m.status !== 'active') return null;
  return m;
}

function startMission(playerId, teamDroidIds) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  if (activeMission(player)) throw new RiftError('IN_PROGRESS', 'You already have a Rift mission in progress');
  if (!Array.isArray(teamDroidIds) || teamDroidIds.length !== TEAM_SIZE) {
    throw new RiftError('BAD_TEAM', `Take exactly ${TEAM_SIZE} droids into the Rift`);
  }
  // Entry cost (confirmed): a Space Rift run consumes one Rift Cube.
  // Charged only after the team validates, so a rejected team doesn't
  // silently eat the cube.
  // Entry cost is admin-tunable from the balance panel.
  const entry = db.modeCost('rift', 'riftCubes', RIFT_ENTRY_CUBES);
  if (entry.quantity > 0 && (player[entry.itemKey] || 0) < entry.quantity) {
    throw new RiftError('NO_RIFT_CUBE', `You need ${entry.quantity} ${entry.itemKey} to enter a Space Rift — buy them in the Shop`);
  }

  const workshop = require('./workshop');
  const team = teamDroidIds.map((id) => {
    const d = db.ownedDroids.get(id);
    if (!d || d.playerId !== playerId) throw new RiftError('NO_DROID', 'One of those droids is not yours');
    if (d.fortId) throw new RiftError('IN_FORT', 'A garrisoned droid cannot enter the Rift');
    if (d.smugglerRun) throw new RiftError('ON_RUN', "That droid is out on a Smuggler's Run");
    const e = workshop.enrichDroid(d);
    if (e.fainted) throw new RiftError('FAINTED', `${e.speciesName} is fainted — heal it first`);
    return {
      droidId: d.id,
      name: e.speciesName,
      speciesId: d.speciesId,
      rarity: e.rarity,
      maxHp: e.hp,
      hp: e.currentHp,
      attack: e.attack,
    };
  });

  const seed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const map = buildMap(seed);

  // Team validated and map built — safe to charge now.
  if (entry.quantity > 0) player[entry.itemKey] -= entry.quantity;

  player.riftMission = {
    playerId,
    seed,
    status: 'active',
    startedAt: Date.now(),
    x: map.start.x,
    y: map.start.y,
    team,
    // Deltas only — never the grid.
    opened: [],        // chest/debris/crystal ids
    bossesDefeated: [],
    healingUses: 0,
    steps: 0,
    loot: { crystals: 0, materials: {} },
    captured: [],
    encounter: null,
    // Jet pack: awarded on reaching the extract point with bosses still
    // alive. Lets you teleport back to the exit later instead of walking.
    hasJetPack: false,
    // Player-dropped markers. 10 per mission, permanent once placed.
    flags: [],
    flagsLeft: RIFT_FLAG_COUNT,
  };
  return viewFor(playerId);
}

function abandonMission(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  // Abandoning forfeits everything — that's the risk half of risk/reward.
  player.riftMission = null;
  return { abandoned: true };
}

// ============================================================
// MOVEMENT
// ============================================================

function move(playerId, dir) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  if (m.encounter) throw new RiftError('IN_BATTLE', 'Finish the encounter first');

  const deltas = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const d = deltas[dir];
  if (!d) throw new RiftError('BAD_DIR', 'Unknown direction');

  const map = buildMap(m.seed);
  const nx = m.x + d[0];
  const ny = m.y + d[1];
  if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) throw new RiftError('BLOCKED', 'The Rift wall blocks your path');
  if (!map.grid[ny * MAP_W + nx]) throw new RiftError('BLOCKED', 'The Rift wall blocks your path');

  m.x = nx; m.y = ny;
  m.steps++;

  // A boss standing on this cell is a gate: you cannot walk past it.
  const boss = map.bosses.find((b) => b.x === nx && b.y === ny && !m.bossesDefeated.includes(b.id));
  if (boss) {
    m.encounter = makeEncounter('boss', boss, m);
    return { ...viewFor(playerId), triggered: 'boss' };
  }

  if (m.auraStepsLeft > 0) m.auraStepsLeft -= 1;

  // Bubble Shield: suppresses wild spawns for a set number of steps.
  // Ticks down on every step taken while active.
  if (m.shieldStepsLeft > 0) {
    m.shieldStepsLeft -= 1;
    return { ...viewFor(playerId), shieldActive: true };
  }

  // Wild encounter roll.
  const rand = Math.random();
  if (rand < WILD_ENCOUNTER_CHANCE) {
    const wild = rollWildDroid(m);
    m.encounter = makeEncounter('wild', wild, m);
    return { ...viewFor(playerId), triggered: 'wild' };
  }

  return viewFor(playerId);
}

function rollWildDroid(m) {
  // Commons and Uncommons in the world, per the spec. Rares and the
  // Legendary are chest/boss rewards instead, so they stay special.
  // Rift Aura is the exception: while active it pulls Rare and Legendary
  // droids into the wild pool and skews the weighting toward them.
  const auraOn = m.auraStepsLeft > 0;
  const pool = auraOn
    ? RIFT_DROIDS.slice()
    : RIFT_DROIDS.filter((d) => d.rarity === 'common' || d.rarity === 'uncommon');
  const weights = pool.map((d) => {
    if (!auraOn) return d.rarity === 'common' ? 4 : 1;
    if (d.rarity === 'common') return 2;
    if (d.rarity === 'uncommon') return 2;
    if (d.rarity === 'rare') return 3;
    return 2; // legendary
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[0];
}

function makeEncounter(kind, def, m) {
  return {
    kind,
    defId: def.id,
    name: def.name,
    move: def.move,
    alignment: def.alignment,
    rarity: def.rarity || 'boss',
    maxHp: def.hp,
    hp: def.hp,
    attack: def.attack,
    activeIndex: m.team.findIndex((t) => t.hp > 0),
    log: [`${def.name} blocks your path!`],
    canRun: kind === 'wild',
    captureOffered: false,
  };
}

// ============================================================
// BATTLE
// ============================================================

function attack(playerId) {
  const player = db.players.get(playerId);
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  const enc = m.encounter;
  if (!enc) throw new RiftError('NO_ENCOUNTER', 'Nothing to fight');
  if (enc.captureOffered) throw new RiftError('RESOLVED', 'That encounter is already won');

  let attacker = m.team[enc.activeIndex];
  if (!attacker || attacker.hp <= 0) {
    const next = m.team.findIndex((t) => t.hp > 0);
    if (next === -1) return wipeOut(player, m);
    enc.activeIndex = next;
    attacker = m.team[next];
  }

  const variance = () => 0.85 + Math.random() * 0.3;
  const dmg = Math.max(1, Math.round(attacker.attack * variance()));
  enc.hp = Math.max(0, enc.hp - dmg);
  enc.log.push(`${attacker.name} hits ${enc.name} for ${dmg}.`);

  if (enc.hp <= 0) {
    enc.log.push(`${enc.name} is defeated!`);
    if (enc.kind === 'boss') {
      m.bossesDefeated.push(enc.defId);
      const reward = bossReward(enc.defId, m);
      enc.log.push(reward.text);
      // Boss counts as defeated immediately (reward + objective progress),
      // but the encounter stays open so a capture can be attempted at a
      // deliberately brutal cosmic-tier rate. Clearing it here is what
      // previously made bosses uncapturable.
      enc.captureOffered = true;
      enc.bossDefeated = true;
      return { ...viewFor(playerId), defeated: 'boss', reward };
    }
    // Wild droid beaten: the spec says capture is offered afterwards.
    enc.captureOffered = true;
    return { ...viewFor(playerId), defeated: 'wild' };
  }

  // Counter-attack.
  const counter = Math.max(1, Math.round(enc.attack * variance()));
  attacker.hp = Math.max(0, attacker.hp - counter);
  enc.log.push(`${enc.name} uses ${enc.move} for ${counter}.`);
  if (attacker.hp === 0) {
    enc.log.push(`${attacker.name} has fainted.`);
    const next = m.team.findIndex((t) => t.hp > 0);
    if (next === -1) return wipeOut(player, m);
    enc.activeIndex = next;
  }
  if (enc.log.length > 40) enc.log.splice(0, enc.log.length - 40);
  return viewFor(playerId);
}

function wipeOut(player, m) {
  // Losing ends the run. Loot gathered so far is kept — losing the whole
  // haul on the last boss would make the mode feel punishing rather than
  // tense, and the droids all leave healed anyway.
  m.status = 'failed';
  m.endedAt = Date.now();
  const summary = finish(player, m, false);
  return { finished: true, failed: true, summary };
}

const ITEM_DURATIONS = { bubbleShields: 50, riftAuras: 50 };

// Consume one of the three Rift consumables mid-mission.
function useItem(playerId, itemKey) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  if ((player[itemKey] || 0) < 1) throw new RiftError('NO_ITEM', 'You do not have that item');

  if (itemKey === 'bubbleShields') {
    player.bubbleShields -= 1;
    m.shieldStepsLeft = ITEM_DURATIONS.bubbleShields;
    return { ...viewFor(playerId), used: 'bubbleShields', stepsLeft: m.shieldStepsLeft };
  }
  if (itemKey === 'riftAuras') {
    player.riftAuras -= 1;
    m.auraStepsLeft = ITEM_DURATIONS.riftAuras;
    return { ...viewFor(playerId), used: 'riftAuras', stepsLeft: m.auraStepsLeft };
  }
  if (itemKey === 'bossTrackers') {
    // Points toward the nearest boss still standing, same idea as the
    // existing healing-post hint rather than revealing the whole map.
    const map = buildMap(m.seed);
    const live = map.bosses.filter((b) => !m.bossesDefeated.includes(b.id));
    if (!live.length) throw new RiftError('NO_BOSSES', 'Every Rift Boss is already down');
    player.bossTrackers -= 1;
    let best = live[0];
    let bestDist = Infinity;
    live.forEach((b) => {
      const dist = Math.abs(b.x - m.x) + Math.abs(b.y - m.y);
      if (dist < bestDist) { bestDist = dist; best = b; }
    });
    const dx = best.x - m.x;
    const dy = best.y - m.y;
    const parts = [];
    if (dy < 0) parts.push(`${Math.abs(dy)} north`);
    if (dy > 0) parts.push(`${Math.abs(dy)} south`);
    if (dx < 0) parts.push(`${Math.abs(dx)} west`);
    if (dx > 0) parts.push(`${Math.abs(dx)} east`);
    m.bossHint = { name: best.name, distance: bestDist, text: parts.join(', ') || 'right here' };
    return { ...viewFor(playerId), used: 'bossTrackers', hint: m.bossHint };
  }
  throw new RiftError('BAD_ITEM', 'Unknown item');
}

// Drop a marker on the current tile. Permanent — cannot be picked up.
function dropFlag(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  if (!m.flags) { m.flags = []; m.flagsLeft = RIFT_FLAG_COUNT; }
  if (m.flagsLeft <= 0) throw new RiftError('NO_FLAGS', 'You have used all 10 flags');
  if (m.flags.some((f) => f.x === m.x && f.y === m.y)) {
    throw new RiftError('FLAG_HERE', 'There is already a flag on this tile');
  }
  m.flags.push({ x: m.x, y: m.y });
  m.flagsLeft -= 1;
  return { ...viewFor(playerId), flagDropped: true, flagsLeft: m.flagsLeft };
}

// Teleport straight to the extract point using the jet pack.
function useJetPack(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  if (!m.hasJetPack) throw new RiftError('NO_JETPACK', 'You have not found a jet pack yet');
  if (m.encounter) throw new RiftError('IN_BATTLE', 'Finish the encounter first');
  const map = buildMap(m.seed);
  m.x = map.exit.x;
  m.y = map.exit.y;
  m.hasJetPack = false; // single use
  return { ...viewFor(playerId), jetPackUsed: true };
}

function run(playerId) {
  const player = db.players.get(playerId);
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  const enc = m.encounter;
  if (!enc) throw new RiftError('NO_ENCOUNTER', 'Nothing to run from');
  // A boss that's already been beaten can be walked away from — you keep
  // the kill and the reward, you just decline the capture attempt.
  // Without this a defeated boss would trap the player in the encounter.
  // You can always walk away from an encounter that's already been won —
  // whether that's a beaten boss or a defeated wild droid you can't
  // afford to capture. Only an ACTIVE boss fight blocks running.
  if (!enc.canRun && !enc.bossDefeated && !enc.captureOffered) {
    throw new RiftError('CANNOT_RUN', 'There is no running from a Rift Boss');
  }
  m.encounter = null;
  return viewFor(playerId);
}

// Capture after a won wild fight, using the normal Sparkfield idea of
// spending crystals for a better chance.
function capture(playerId, crystalsSpent = 0) {
  const player = db.players.get(playerId);
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  const enc = m.encounter;
  if (!enc || !enc.captureOffered) throw new RiftError('NOT_CAPTURABLE', 'Nothing to capture');

  const spend = Math.max(0, Math.floor(Number(crystalsSpent) || 0));
  if (spend > (player.crystalBalance || 0)) throw new RiftError('NOT_ENOUGH_CRYSTALS', 'Not enough crystals');
  if (spend) {
    player.crystalBalance -= spend;
    db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -spend, source: 'rift_capture', createdAt: Date.now() });
  }

  // Bosses use a cosmic-tier rate (very low) and consume an Ultra Rift
  // Cell; wild droids consume a normal Rift Cell.
  const isBoss = enc.kind === 'boss';
  if (isBoss) {
    if ((player.ultraRiftCells || 0) < 1) {
      throw new RiftError('NO_ULTRA_CELL', 'You need an Ultra Rift Cell to capture a boss — buy one in the Shop');
    }
  } else if ((player.riftCells || 0) < 1) {
    throw new RiftError('NO_RIFT_CELL', 'You need a Rift Cell to capture in a Rift — buy them in the Shop');
  }

  const base = isBoss
    ? 0.03
    : enc.rarity === 'common' ? 0.55 : enc.rarity === 'uncommon' ? 0.35 : 0.18;
  let bonus = isBoss ? Math.min(0.10, spend / 20000) : Math.min(0.35, spend / 300);
  // Rift Aura also improves capture odds while it's running.
  if (m.auraStepsLeft > 0) bonus += isBoss ? 0.02 : 0.15;
  const success = Math.random() < base + bonus;

  if (isBoss) player.ultraRiftCells -= 1; else player.riftCells -= 1;

  m.encounter = null;
  if (!success) return { ...viewFor(playerId), captured: false };

  m.captured.push(enc.defId);
  return { ...viewFor(playerId), captured: true, capturedName: enc.name };
}

function bossReward(bossId, m) {
  const scanner = riftLootMultiplier(m.playerId);
  // `let`, not `const` — this is scaled by the Rift Scanner bonus below.
  // Declaring it const and then reassigning threw "Assignment to constant
  // variable" on EVERY boss reward, which blocked the whole encounter.
  let crystals = Math.round((2000 + Math.floor(Math.random() * 3000)) * scanner);
  m.loot.crystals += crystals;
  const mats = ['novaChips', 'paint', 'repairKits', 'augmentCores'];
  const mat = mats[Math.floor(Math.random() * mats.length)];
  const amount = Math.max(1, Math.round((1 + Math.floor(Math.random() * 3)) * scanner));
  m.loot.materials[mat] = (m.loot.materials[mat] || 0) + amount;
  return { crystals, material: mat, amount, text: `Recovered ${crystals} crystals and ${amount} ${mat}.` };
}

// ============================================================
// INTERACTABLES
// ============================================================

function investigate(playerId, opts = {}) {
  const player = db.players.get(playerId);
  const m = activeMission(player);
  if (!m) throw new RiftError('NO_MISSION', 'No mission in progress');
  if (m.encounter) throw new RiftError('IN_BATTLE', 'Not while something is attacking you');

  const map = buildMap(m.seed);
  const here = (arr) => arr.find((o) => o.x === m.x && o.y === m.y);

  const chest = here(map.chests);
  if (chest && !m.opened.includes(chest.id)) {
    m.opened.push(chest.id);
    const crystals = 1500 + Math.floor(Math.random() * 3500);
    m.loot.crystals += crystals;
    const pool = ['novaChips', 'paint', 'beacons', 'repairKits', 'energyTubes', 'augmentCores'];
    const mat = pool[Math.floor(Math.random() * pool.length)];
    const amt = 1 + Math.floor(Math.random() * 4);
    m.loot.materials[mat] = (m.loot.materials[mat] || 0) + amt;
    return { ...viewFor(playerId), found: { kind: 'chest', crystals, material: mat, amount: amt } };
  }

  const cr = here(map.crystals);
  if (cr && !m.opened.includes(cr.id)) {
    m.opened.push(cr.id);
    const crystals = 400 + Math.floor(Math.random() * 900);
    m.loot.crystals += crystals;
    return { ...viewFor(playerId), found: { kind: 'crystal', crystals } };
  }

  const db_ = here(map.debris);
  if (db_ && !m.opened.includes(db_.id)) {
    m.opened.push(db_.id);
    const pool = ['novaChips', 'paint'];
    const mat = pool[Math.floor(Math.random() * pool.length)];
    m.loot.materials[mat] = (m.loot.materials[mat] || 0) + 1;
    return { ...viewFor(playerId), found: { kind: 'debris', material: mat, amount: 1 } };
  }

  const post = here(map.healing);
  if (post) {
    if (m.healingUses >= MAX_HEALING_USES) {
      throw new RiftError('NO_HEALS_LEFT', `You've used all ${MAX_HEALING_USES} healing charges for this mission`);
    }
    m.healingUses++;
    m.team.forEach((t) => { t.hp = t.maxHp; });
    return { ...viewFor(playerId), found: { kind: 'heal', usesLeft: MAX_HEALING_USES - m.healingUses } };
  }

  if (opts.confirmEarlyExtract) m.confirmEarlyExtract = true;

  // Standing on the exit finishes the run — if the bosses are done.
  if (m.x === map.exit.x && m.y === map.exit.y) {
    // Early extraction is allowed (confirmed) — you keep the run, but
    // material loot takes a 20% hit. The client asks for confirmation
    // first via `pendingEarlyExtract` so nobody eats the penalty blind.
    const early = m.bossesDefeated.length < REQUIRED_BOSSES;
    // First time you find the extract point without finishing the
    // bosses, you pick up a jet pack — so you can go back to hunting and
    // teleport here later rather than walking the map twice.
    let jetPackAwarded = false;
    if (early && !m.hasJetPack) {
      m.hasJetPack = true;
      jetPackAwarded = true;
    }
    if (early && !m.confirmEarlyExtract) {
      return {
        ...viewFor(playerId),
        pendingEarlyExtract: {
          bossesDefeated: m.bossesDefeated.length,
          totalBosses: REQUIRED_BOSSES,
          penaltyPercent: Math.round(EARLY_EXTRACT_PENALTY * 100),
        },
        jetPackAwarded,
      };
    }
    m.status = 'complete';
    m.endedAt = Date.now();
    const summary = finish(player, m, true, early);
    return { finished: true, escaped: true, earlyExtract: early, summary };
  }

  throw new RiftError('NOTHING_HERE', 'Nothing to investigate here');
}

// ============================================================
// COMPLETION
// ============================================================

function finish(player, m, escaped, earlyExtract = false) {
  // Applied before loot is paid out so the summary the player sees
  // reflects what they actually banked.
  if (earlyExtract && m.loot && m.loot.materials) {
    // Materials live under loot.materials — crystals are deliberately
    // NOT penalised, only material loot, per spec.
    Object.keys(m.loot.materials).forEach((k) => {
      const v = m.loot.materials[k];
      if (typeof v === 'number' && v > 0) {
        m.loot.materials[k] = Math.floor(v * (1 - EARLY_EXTRACT_PENALTY));
      }
    });
  }
  const map = buildMap(m.seed);

  // Loot is granted now, at the end, so a disconnect mid-run can't be
  // used to bank the same chest twice.
  player.crystalBalance = (player.crystalBalance || 0) + m.loot.crystals;
  if (m.loot.crystals) {
    db.crystalTransactions.push({
      id: db.nextId(), playerId: player.id, amount: m.loot.crystals,
      source: escaped ? 'rift_complete' : 'rift_failed', createdAt: Date.now(),
    });
  }
  Object.entries(m.loot.materials).forEach(([k, v]) => { player[k] = (player[k] || 0) + v; });

  // Captured droids join the collection, fully healed per the spec.
  const gained = [];
  // Droid Memory — every droid that went in records the mission, and
  // any bosses this run brought down.
  try {
    const memory = require('./memory');
    (m.team || []).forEach((t) => {
      const d = db.ownedDroids.get(t.droidId || t.id);
      if (!d) return;
      memory.bumpMany(d, {
        riftMissions: 1,
        missionsCompleted: 1,
        bossesDefeated: (m.bossesDefeated || []).length,
      });
    });
  } catch (e) {}

  m.captured.forEach((defId) => {
    // Bosses are capturable now, and they live in BOSSES, not
    // DROID_BY_ID — looking only in DROID_BY_ID would silently drop a
    // captured boss on the floor at mission end.
    const def = DROID_BY_ID[defId] || BOSSES.find((b) => b.id === defId);
    if (!def) return;
    const species = db.droidSpecies.find((s) => s.name === def.name);
    if (!species) return;
    const d = {
      id: db.nextId(), playerId: player.id, speciesId: species.id,
      variant: 'standard', level: 1, captureCost: 0, capturedAt: Date.now(),
      workshopSlotId: null, currentHpDamage: 0, hiddenFromTrade: false,
      fromRift: true,
    };
    db.ownedDroids.set(d.id, d);
    db.markDexSeen(player.id, species.id, 'standard');
    gained.push(def.name);
  });

  // Mission damage never carries out of the Rift.
  const summary = {
    escaped,
    seed: m.seed,
    steps: m.steps,
    bossesDefeated: m.bossesDefeated.length,
    totalBosses: REQUIRED_BOSSES,
    chestsOpened: m.opened.filter((i) => i.startsWith('chest')).length,
    totalChests: map.chests.length,
    debrisSearched: m.opened.filter((i) => i.startsWith('debris')).length,
    crystalPoints: m.opened.filter((i) => i.startsWith('crystal')).length,
    healingUses: m.healingUses,
    maxHealing: MAX_HEALING_USES,
    crystals: m.loot.crystals,
    materials: m.loot.materials,
    captured: gained,
  };

  try {
    const levels = require('./levels');
    levels.awardXp(player.id, 'battleWin', m.bossesDefeated.length);
    require('./ladder').award(player.id, 'titanWin', m.bossesDefeated.length);
    require('./seasonpass').awardXp(player.id, 'titanWin', m.bossesDefeated.length);
  } catch (e) {}

  player.riftMission = null;
  player.riftHistory = player.riftHistory || [];
  player.riftHistory.unshift({ at: Date.now(), ...summary });
  if (player.riftHistory.length > 10) player.riftHistory.length = 10;
  return summary;
}

// ============================================================
// VIEW
// ============================================================
//
// Only the cells around the player, so the client renders ~225 tiles
// per move rather than 22,500.

function viewFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new RiftError('NO_PLAYER', 'Player not found');
  const m = player.riftMission;
  if (!m || m.status !== 'active') {
    return { active: false, teamSize: TEAM_SIZE, history: (player.riftHistory || []).slice(0, 5) };
  }

  const map = buildMap(m.seed);
  const x0 = m.x - VIEW_RADIUS;
  const y0 = m.y - VIEW_RADIUS;
  const size = VIEW_RADIUS * 2 + 1;

  const rows = [];
  for (let y = y0; y < y0 + size; y++) {
    let row = '';
    for (let x = x0; x < x0 + size; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) { row += T.WALL; continue; }
      row += map.grid[y * MAP_W + x] ? T.FLOOR : T.WALL;
    }
    rows.push(row);
  }

  // Objects inside the viewport only.
  const inView = (o) => o.x >= x0 && o.x < x0 + size && o.y >= y0 && o.y < y0 + size;
  const rel = (o, extra = {}) => ({ x: o.x - x0, y: o.y - y0, ...extra });

  const objects = [];
  map.chests.filter(inView).forEach((o) => objects.push(rel(o, { kind: 'chest', id: o.id, used: m.opened.includes(o.id) })));
  map.debris.filter(inView).forEach((o) => objects.push(rel(o, { kind: 'debris', id: o.id, used: m.opened.includes(o.id) })));
  map.crystals.filter(inView).forEach((o) => objects.push(rel(o, { kind: 'crystal', id: o.id, used: m.opened.includes(o.id) })));
  map.healing.filter(inView).forEach((o) => objects.push(rel(o, { kind: 'heal', id: o.id, used: false })));
  map.scenery.filter(inView).forEach((o) => objects.push(rel(o, { kind: 'scenery', variant: o.kind, id: o.id })));
  map.bosses.filter(inView).forEach((o) => objects.push(rel(o, {
    kind: 'boss', id: o.id, name: o.name, used: m.bossesDefeated.includes(o.id),
  })));
  if (inView(map.exit)) objects.push(rel(map.exit, { kind: 'exit', id: 'exit' }));
  if (inView(map.start)) objects.push(rel(map.start, { kind: 'start', id: 'start' }));

  // What's under the player's feet, so the Investigate button can label
  // itself instead of being a guess.
  let standingOn = null;
  const at = (arr) => arr.find((o) => o.x === m.x && o.y === m.y);
  const c = at(map.chests); const cr = at(map.crystals); const de = at(map.debris); const he = at(map.healing);
  if (c && !m.opened.includes(c.id)) standingOn = 'chest';
  else if (cr && !m.opened.includes(cr.id)) standingOn = 'crystal';
  else if (de && !m.opened.includes(de.id)) standingOn = 'debris';
  else if (he) standingOn = 'heal';
  else if (m.x === map.exit.x && m.y === map.exit.y) standingOn = 'exit';

  // Nearest unused healing post, as a compass hint only (direction and
  // rough distance, never the exact cell) — you still have to find it.
  let healHint = null;
  if (m.healingUses < MAX_HEALING_USES) {
    let best = null; let bestD = Infinity;
    map.healing.forEach((h) => {
      const d = Math.abs(h.x - m.x) + Math.abs(h.y - m.y);
      if (d < bestD) { bestD = d; best = h; }
    });
    if (best) {
      const dx = best.x - m.x; const dy = best.y - m.y;
      const compass = `${dy < -2 ? 'N' : dy > 2 ? 'S' : ''}${dx > 2 ? 'E' : dx < -2 ? 'W' : ''}` || 'here';
      healHint = { compass, distance: bestD };
    }
  }

  return {
    active: true,
    seed: m.seed,
    healHint,
    mapW: MAP_W, mapH: MAP_H,
    viewSize: size,
    playerView: { x: VIEW_RADIUS, y: VIEW_RADIUS },
    playerPos: { x: m.x, y: m.y },
    rows,
    objects,
    standingOn,
    team: m.team,
    // Flag whether this species is already in the player's Dex, so the
    // encounter can show a ✅ the same way overworld spawns do.
    encounter: m.encounter ? {
      ...m.encounter,
      alreadyCaught: (() => {
        const def = DROID_BY_ID[m.encounter.defId] || BOSSES.find((b) => b.id === m.encounter.defId);
        if (!def) return false;
        const species = db.droidSpecies.find((s) => s.name === def.name);
        return Boolean(species && (player.dexSeen || []).includes(species.id));
      })(),
    } : null,
    bossesDefeated: m.bossesDefeated.length,
    totalBosses: REQUIRED_BOSSES,
    bossList: map.bosses.map((b) => ({ id: b.id, name: b.name, move: b.move, defeated: m.bossesDefeated.includes(b.id) })),
    healingUses: m.healingUses,
    maxHealing: MAX_HEALING_USES,
    chestsOpened: m.opened.filter((i) => i.startsWith('chest')).length,
    totalChests: map.chests.length,
    steps: m.steps,
    loot: m.loot,
    captured: m.captured.map((id) => (DROID_BY_ID[id] || {}).name).filter(Boolean),
    exitPos: map.exit,
    shieldStepsLeft: m.shieldStepsLeft || 0,
    auraStepsLeft: m.auraStepsLeft || 0,
    bossHint: m.bossHint || null,
    hasJetPack: !!m.hasJetPack,
    flags: m.flags || [],
    flagsLeft: typeof m.flagsLeft === 'number' ? m.flagsLeft : RIFT_FLAG_COUNT,
    cells: {
      riftCells: player.riftCells || 0,
      ultraRiftCells: player.ultraRiftCells || 0,
    },
    items: {
      bubbleShields: player.bubbleShields || 0,
      riftAuras: player.riftAuras || 0,
      bossTrackers: player.bossTrackers || 0,
    },
  };
}

// Team candidates for the launch screen.
function teamCandidates(playerId) {
  const workshop = require('./workshop');
  return [...db.ownedDroids.values()]
    // Mirror every rejection startMission makes, so nothing appears in
    // the picker that would be refused on launch. Previously droids out
    // on a Smuggler's Run were listed but couldn't actually be taken.
    .filter((d) => d.playerId === playerId && !d.fortId && !d.smugglerRun)
    .map((d) => {
      const e = workshop.enrichDroid(d);
      return {
        id: d.id, name: e.speciesName, rarity: e.rarity, level: e.level,
        hp: e.currentHp, maxHp: e.hp, attack: e.attack, fainted: e.fainted,
      };
    })
    .filter((d) => !d.fainted)
    .sort((a, b) => b.attack - a.attack);
}

module.exports = {
  MAP_W, MAP_H, VIEW_RADIUS, TEAM_SIZE, REQUIRED_BOSSES, MAX_HEALING_USES,
  BOSSES, RIFT_DROIDS, DROID_BY_ID,
  generate, buildMap, populate, floodReachable, mulberry32,
  startMission, abandonMission, move, attack, run, capture, investigate, useItem, dropFlag, useJetPack,
  viewFor, teamCandidates, activeMission,
  RiftError,
};
