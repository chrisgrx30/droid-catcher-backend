// ---- Rift Storms ----
// A shared, time-limited event. Up to 4 players enter the same Rift at
// once, fight a global boss together, and their DROIDS' alignment
// decides how the storm resolves.
//
// Light vs Dark comes from the droids a player actually fights with —
// there's no separate faction to pick, so the identity players already
// built through their collection is what counts.

const db = require('./db');
const workshop = require('./workshop');
const realtime = require('./realtime');
const rift = require('./rift');
const memory = require('./memory');

class StormError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const MAX_PARTICIPANTS = 4;
const DEFAULT_DURATION_MS = 45 * 60 * 1000;   // 45 min, inside the 30–60 spec
const BOSS_BASE_HP = 250000;

// ---- Capture ----
// Both sides get one attempt once the Sovereign falls. The winning side
// gets meaningfully better odds, so the Light/Dark result matters beyond
// loot. Up to MAX_CAPTURES players can succeed — after that the rest are
// told it's gone rather than rolling a dice they can't win.
const SOVEREIGN_NAME = 'The Sovereign';
const CAPTURE_RATE_WINNING = 0.30;
const CAPTURE_RATE_LOSING = 0.10;
const MAX_CAPTURES = 2;
const CAPTURE_CELL_COST = 1;   // Ultra Rift Cells

// ---- In-storm discoveries ----
// Every strike has a small chance to turn up something besides damage.
// Rates are deliberately low so a storm still reads as a boss fight
// rather than a slot machine.
const CHEST_CHANCE = 0.08;
const PORTAL_CHANCE = 0.05;
const EXCLUSIVE_CHANCE = 0.04;

// Storm-exclusive droids — the Rift Guardians / Riftborn only appear
// during a storm, and which side is winning decides which pool you draw
// from. That gives the Light/Dark tug-of-war a second consequence.
const STORM_EXCLUSIVE = {
  light: ['Aetherion', 'Solaryx', 'Luminarc', 'Abyssara', 'Drakoryn'],
  dark: ['Voidfang', 'Gravemaw', 'Nexulon', 'Dreadhorn', 'Malivex'],
};

// A portal skips you straight to a heavy strike — the reward is tempo,
// not loot, which keeps it from inflating the economy.
const PORTAL_DAMAGE_MULT = 3;
const TEAM_SIZE = 4;

// Random storms. Checked on tick; deliberately rare so one feels like an
// event rather than background noise.
const RANDOM_CHANCE_PER_TICK = 0.02;
const MIN_GAP_MS = 2 * 60 * 60 * 1000;        // never two within 2 hours

const storms = new Map();   // id -> storm
let lastStormEndedAt = 0;

function activeStorm() {
  for (const s of storms.values()) {
    if (s.status === 'active' && Date.now() < s.endsAt) return s;
  }
  return null;
}

function stormById(id) {
  return storms.get(id) || null;
}

// A droid's alignment decides which side its damage counts for. Cosmic
// droids are deliberately neutral — they contribute damage to the boss
// but don't push the outcome either way.
function sideOfDroid(droid) {
  const species = db.droidSpecies.find((s) => s.id === droid.speciesId);
  if (!species) return 'neutral';
  if (species.alignment === 'light') return 'light';
  if (species.alignment === 'dark') return 'dark';
  return 'neutral';
}

function openStorm({ durationMs = DEFAULT_DURATION_MS, triggeredBy = 'random' } = {}) {
  if (activeStorm()) throw new StormError('ALREADY_OPEN', 'A Rift Storm is already raging');

  const now = Date.now();
  const storm = {
    id: db.nextId(),
    status: 'active',
    triggeredBy,
    startedAt: now,
    endsAt: now + durationMs,
    boss: {
      name: 'The Sovereign',
      maxHp: BOSS_BASE_HP,
      hp: BOSS_BASE_HP,
    },
    participants: [],          // { playerId, username, joinedAt, teamIds }
    contributions: {},         // playerId -> { light, dark, neutral, total, attacks }
    totals: { light: 0, dark: 0, neutral: 0 },
    log: [],
    resolution: null,
    captures: [],              // { playerId, username, droidId }
    captureAttempts: {},       // playerId -> true (one attempt each)
  };
  storms.set(storm.id, storm);

  realtime.broadcast('storm:open', {
    stormId: storm.id,
    endsAt: storm.endsAt,
    boss: storm.boss,
    maxParticipants: MAX_PARTICIPANTS,
  });
  return storm;
}

function join(playerId, teamDroidIds) {
  const player = db.players.get(playerId);
  if (!player) throw new StormError('NO_PLAYER', 'Player not found');
  const storm = activeStorm();
  if (!storm) throw new StormError('NO_STORM', 'There is no Rift Storm right now');
  if (storm.participants.some((p) => p.playerId === playerId)) {
    throw new StormError('ALREADY_IN', 'You are already in this storm');
  }
  if (storm.participants.length >= MAX_PARTICIPANTS) {
    throw new StormError('FULL', `The storm is full (${MAX_PARTICIPANTS} players)`);
  }
  if (!Array.isArray(teamDroidIds) || teamDroidIds.length !== TEAM_SIZE) {
    throw new StormError('BAD_TEAM', `Take exactly ${TEAM_SIZE} droids into the storm`);
  }

  // Same eligibility rules as a normal Rift run, so a droid can't be in
  // two places at once.
  teamDroidIds.forEach((id) => {
    const d = db.ownedDroids.get(id);
    if (!d || d.playerId !== playerId) throw new StormError('NO_DROID', 'One of those droids is not yours');
    if (d.fortId) throw new StormError('IN_FORT', 'A garrisoned droid cannot enter the storm');
    if (d.smugglerRun) throw new StormError('ON_RUN', "That droid is out on a Smuggler's Run");
    if (workshop.enrichDroid(d).fainted) throw new StormError('FAINTED', 'One of those droids is fainted');
  });

  storm.participants.push({
    playerId,
    username: player.username,
    joinedAt: Date.now(),
    teamIds: [...teamDroidIds],
  });
  storm.contributions[playerId] = { light: 0, dark: 0, neutral: 0, total: 0, attacks: 0 };

  realtime.broadcast('storm:join', {
    stormId: storm.id,
    playerId,
    username: player.username,
    participants: storm.participants.length,
  });
  return viewFor(playerId);
}

// One attack against the global boss. Damage is summed per side so the
// resolution reflects who actually did the work.
function attack(playerId, droidId) {
  const storm = activeStorm();
  if (!storm) throw new StormError('NO_STORM', 'There is no Rift Storm right now');
  const entry = storm.participants.find((p) => p.playerId === playerId);
  if (!entry) throw new StormError('NOT_IN', 'You are not in this storm');
  if (storm.boss.hp <= 0) throw new StormError('BOSS_DOWN', 'The The Sovereign has already fallen');

  // If no droid is named, pick the first one still standing. Defaulting
  // to teamIds[0] blindly meant one fainted droid blocked the whole team
  // from attacking at all.
  let useId = droidId;
  if (useId == null) {
    useId = entry.teamIds.find((id) => {
      const d = db.ownedDroids.get(id);
      return d && !workshop.enrichDroid(d).fainted;
    });
    if (useId == null) throw new StormError('ALL_FAINTED', 'Your whole storm team has fainted — heal them to keep fighting');
  }
  if (!entry.teamIds.includes(useId)) throw new StormError('NOT_ON_TEAM', 'That droid is not on your storm team');
  const droid = db.ownedDroids.get(useId);
  if (!droid) throw new StormError('NO_DROID', 'Droid not found');

  const e = workshop.enrichDroid(droid);
  if (e.fainted) throw new StormError('FAINTED', `${e.speciesName} has fainted`);

  const variance = 0.85 + Math.random() * 0.3;
  const damage = Math.max(1, Math.round(e.attack * variance));
  storm.boss.hp = Math.max(0, storm.boss.hp - damage);

  const side = sideOfDroid(droid);
  const c = storm.contributions[playerId];
  c[side] += damage;
  c.total += damage;
  c.attacks += 1;
  storm.totals[side] += damage;

  // The boss hits back — storms cost something.
  const counter = Math.max(1, Math.round(damage * 0.35));
  droid.currentHpDamage = (droid.currentHpDamage || 0) + counter;

  try { memory.bump(droid, 'battles'); } catch (err) {}

  const logEntry = {
    at: Date.now(),
    playerId,
    username: entry.username,
    droidName: e.speciesName,
    side,
    damage,
    bossHp: storm.boss.hp,
  };
  // --- Discoveries ---
  const player = db.players.get(playerId);
  const finds = [];

  if (player && Math.random() < CHEST_CHANCE) {
    const crystals = 3000 + Math.floor(Math.random() * 7000);
    const cells = 1 + Math.floor(Math.random() * 3);
    player.crystalBalance = (player.crystalBalance || 0) + crystals;
    player.riftCells = (player.riftCells || 0) + cells;
    db.crystalTransactions.push({
      id: db.nextId(), playerId, amount: crystals,
      source: 'storm_chest', createdAt: Date.now(),
    });
    finds.push({ kind: 'chest', crystals, riftCells: cells });
  }

  if (Math.random() < PORTAL_CHANCE && storm.boss.hp > 0) {
    // Temporary portal — a free extra strike at triple force.
    const bonus = damage * PORTAL_DAMAGE_MULT;
    storm.boss.hp = Math.max(0, storm.boss.hp - bonus);
    c[side] += bonus;
    c.total += bonus;
    storm.totals[side] += bonus;
    finds.push({ kind: 'portal', bonusDamage: bonus });
  }

  // Storm-exclusive droid — drawn from whichever side currently leads.
  if (player && Math.random() < EXCLUSIVE_CHANCE) {
    const leading = storm.totals.light >= storm.totals.dark ? 'light' : 'dark';
    const pool = STORM_EXCLUSIVE[leading] || [];
    const name = pool[Math.floor(Math.random() * pool.length)];
    const species = name ? db.droidSpecies.find((s) => s.name === name) : null;
    if (species) {
      const d = {
        id: db.nextId(), playerId, speciesId: species.id, variant: 'standard',
        level: 1, captureCost: 0, capturedAt: Date.now(),
        workshopSlotId: null, currentHpDamage: 0, fromStorm: true,
      };
      db.ownedDroids.set(d.id, d);
      db.markDexSeen(playerId, species.id, 'standard');
      try {
        memory.recordCapture(d, { playerId, sector: 'Rift Storm' });
        memory.bump(d, 'riftStormsSurvived');
      } catch (e) {}
      finds.push({ kind: 'droid', name: species.name, rarity: species.rarity, side: leading });
    }
  }

  if (finds.length) logEntry.finds = finds;

  storm.log.push(logEntry);
  if (storm.log.length > 200) storm.log.shift();

  realtime.broadcast('storm:hit', {
    stormId: storm.id,
    ...logEntry,
    totals: storm.totals,
  });

  if (storm.boss.hp <= 0) resolve(storm, 'defeated');
  return viewFor(playerId);
}

// Resolution — Light vs Dark decides which reward set everyone gets.
function resolve(storm, reason) {
  if (storm.status !== 'active') return storm;
  storm.status = 'finished';
  storm.endedAt = Date.now();
  lastStormEndedAt = storm.endedAt;

  const { light, dark } = storm.totals;
  const outcome = light === dark ? 'balanced' : (light > dark ? 'stabilised' : 'collapsed');
  const bossDefeated = storm.boss.hp <= 0;

  const rewards = {};
  storm.participants.forEach((p) => {
    const c = storm.contributions[p.playerId] || { total: 0 };
    const player = db.players.get(p.playerId);
    if (!player) return;

    // Everyone who showed up gets something; contribution scales it.
    const share = storm.totals.light + storm.totals.dark + storm.totals.neutral;
    const ratio = share > 0 ? c.total / share : 0;
    const scale = bossDefeated ? 1 : 0.4;   // partial credit if it survived

    const reward = { crystals: 0, riftCubes: 0, ultraRiftCells: 0, riftCells: 0 };
    reward.crystals = Math.round((20000 + 60000 * ratio) * scale);

    if (outcome === 'stabilised') {
      // Light wins: the Rift holds — steady, usable materials.
      reward.riftCells = Math.max(1, Math.round((3 + 8 * ratio) * scale));
      reward.riftCubes = Math.max(1, Math.round((1 + 3 * ratio) * scale));
    } else if (outcome === 'collapsed') {
      // Dark wins: the Rift tears open — rarer, spikier rewards.
      reward.ultraRiftCells = Math.max(1, Math.round((1 + 3 * ratio) * scale));
      reward.riftCubes = Math.max(1, Math.round((2 + 4 * ratio) * scale));
    } else {
      reward.riftCells = Math.max(1, Math.round((2 + 4 * ratio) * scale));
      reward.riftCubes = Math.max(1, Math.round((1 + 2 * ratio) * scale));
    }

    player.crystalBalance = (player.crystalBalance || 0) + reward.crystals;
    db.crystalTransactions.push({
      id: db.nextId(), playerId: p.playerId, amount: reward.crystals,
      source: 'rift_storm', createdAt: storm.endedAt,
    });
    player.riftCells = (player.riftCells || 0) + reward.riftCells;
    player.riftCubes = (player.riftCubes || 0) + reward.riftCubes;
    player.ultraRiftCells = (player.ultraRiftCells || 0) + reward.ultraRiftCells;

    // Surviving a storm is part of a droid's permanent record.
    (p.teamIds || []).forEach((id) => {
      const d = db.ownedDroids.get(id);
      if (d) { try { memory.bump(d, 'riftStormsSurvived'); } catch (e) {} }
    });

    rewards[p.playerId] = reward;
  });

  storm.resolution = {
    outcome,
    reason,
    bossDefeated,
    totals: { ...storm.totals },
    rewards,
    headline: outcome === 'stabilised' ? 'THE RIFT IS STABILISED'
            : outcome === 'collapsed' ? 'THE RIFT COLLAPSES'
            : 'THE RIFT HOLDS IN BALANCE',
  };

  realtime.broadcast('storm:resolved', {
    stormId: storm.id,
    resolution: storm.resolution,
  });
  return storm;
}

// One capture attempt at the Sovereign, available only after it falls
// and only to players who actually took part.
function captureSovereign(playerId) {
  const storm = [...storms.values()].sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))[0];
  if (!storm) throw new StormError('NO_STORM', 'There is no Rift Storm to capture from');
  if (storm.status !== 'finished') throw new StormError('NOT_OVER', 'The storm is still raging');
  if (!storm.resolution || !storm.resolution.bossDefeated) {
    throw new StormError('NOT_DEFEATED', 'The The Sovereign escaped — it was never brought down');
  }

  const entry = storm.participants.find((p) => p.playerId === playerId);
  if (!entry) throw new StormError('NOT_IN', 'You did not take part in that storm');

  storm.captureAttempts = storm.captureAttempts || {};
  if (storm.captureAttempts[playerId]) throw new StormError('ALREADY_TRIED', 'You have already made your attempt');
  if ((storm.captures || []).length >= MAX_CAPTURES) {
    throw new StormError('GONE', 'The The Sovereign has already been claimed');
  }

  const player = db.players.get(playerId);
  if (!player) throw new StormError('NO_PLAYER', 'Player not found');
  if ((player.ultraRiftCells || 0) < CAPTURE_CELL_COST) {
    throw new StormError('NO_ULTRA_CELL', 'You need an Ultra Rift Cell to attempt the The Sovereign');
  }

  // Which side did this player mostly fight for?
  const c = storm.contributions[playerId] || { light: 0, dark: 0 };
  const mySide = c.light === c.dark ? 'neutral' : (c.light > c.dark ? 'light' : 'dark');
  const winningSide = storm.resolution.outcome === 'stabilised' ? 'light'
                    : storm.resolution.outcome === 'collapsed' ? 'dark' : null;
  const onWinningSide = winningSide != null && mySide === winningSide;

  player.ultraRiftCells -= CAPTURE_CELL_COST;
  storm.captureAttempts[playerId] = true;

  const rate = onWinningSide ? CAPTURE_RATE_WINNING : CAPTURE_RATE_LOSING;
  const success = Math.random() < rate;

  if (!success) {
    realtime.broadcast('storm:capture-failed', { stormId: storm.id, playerId, username: entry.username });
    return { captured: false, rate, onWinningSide, mySide, capturesLeft: MAX_CAPTURES - storm.captures.length };
  }

  const species = db.droidSpecies.find((s) => s.name === SOVEREIGN_NAME);
  if (!species) throw new StormError('NO_SPECIES', 'The Sovereign species is missing');

  const droid = {
    id: db.nextId(),
    playerId,
    speciesId: species.id,
    variant: 'standard',
    level: 1,
    captureCost: 0,
    capturedAt: Date.now(),
    workshopSlotId: null,
    currentHpDamage: 0,
    fromStorm: true,
  };
  db.ownedDroids.set(droid.id, droid);
  db.markDexSeen(playerId, species.id, 'standard');

  // Origin record — a Sovereign should always show which storm it came
  // from and which side its captor fought for.
  try {
    memory.recordCapture(droid, {
      playerId,
      sector: `Rift Storm — ${storm.resolution.headline}`,
    });
    memory.bump(droid, 'riftStormsSurvived');
  } catch (e) {}

  storm.captures.push({ playerId, username: entry.username, droidId: droid.id });
  realtime.broadcast('storm:captured', {
    stormId: storm.id, playerId, username: entry.username,
    capturesLeft: MAX_CAPTURES - storm.captures.length,
  });

  return {
    captured: true, rate, onWinningSide, mySide,
    droidId: droid.id,
    capturesLeft: MAX_CAPTURES - storm.captures.length,
  };
}

// Called from the server tick. Ends expired storms and occasionally
// opens a new one.
function tick() {
  const now = Date.now();
  for (const s of storms.values()) {
    if (s.status === 'active' && now >= s.endsAt) resolve(s, 'expired');
  }
  if (activeStorm()) return;
  if (now - lastStormEndedAt < MIN_GAP_MS) return;
  if (Math.random() < RANDOM_CHANCE_PER_TICK) {
    try { openStorm({ triggeredBy: 'random' }); } catch (e) {}
  }
}

function viewFor(playerId) {
  const storm = activeStorm() || [...storms.values()].sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))[0];
  if (!storm) return { active: false };

  const me = storm.participants.find((p) => p.playerId === playerId) || null;
  return {
    active: storm.status === 'active',
    stormId: storm.id,
    status: storm.status,
    startedAt: storm.startedAt,
    endsAt: storm.endsAt,
    msRemaining: Math.max(0, storm.endsAt - Date.now()),
    boss: { ...storm.boss, percent: Math.round((storm.boss.hp / storm.boss.maxHp) * 100) },
    maxParticipants: MAX_PARTICIPANTS,
    teamSize: TEAM_SIZE,
    participants: storm.participants.map((p) => ({
      playerId: p.playerId,
      username: p.username,
      contribution: storm.contributions[p.playerId] || { total: 0 },
    })),
    totals: { ...storm.totals },
    // Live tug-of-war bar.
    lightPercent: (storm.totals.light + storm.totals.dark) > 0
      ? Math.round((storm.totals.light / (storm.totals.light + storm.totals.dark)) * 100)
      : 50,
    joined: Boolean(me),
    myTeam: me ? me.teamIds.map((id) => {
      const d = db.ownedDroids.get(id);
      if (!d) return null;
      const e = workshop.enrichDroid(d);
      return {
        id: d.id, speciesName: e.speciesName, rarity: e.rarity,
        hp: e.hp, currentHp: e.currentHp, attack: e.attack,
        fainted: e.fainted, side: sideOfDroid(d),
      };
    }).filter(Boolean) : [],
    myContribution: me ? storm.contributions[playerId] : null,
    log: storm.log.slice(-25).reverse(),
    resolution: storm.resolution,
    // Capture state — only meaningful once the storm has ended.
    capture: (() => {
      const done = (storm.captures || []).length;
      const mine = (storm.captures || []).find((x) => x.playerId === playerId) || null;
      const c = storm.contributions[playerId] || { light: 0, dark: 0 };
      const mySide = c.light === c.dark ? 'neutral' : (c.light > c.dark ? 'light' : 'dark');
      const winningSide = storm.resolution
        ? (storm.resolution.outcome === 'stabilised' ? 'light'
          : storm.resolution.outcome === 'collapsed' ? 'dark' : null)
        : null;
      return {
        available: Boolean(
          storm.status === 'finished' &&
          storm.resolution && storm.resolution.bossDefeated &&
          me && !(storm.captureAttempts || {})[playerId] &&
          done < MAX_CAPTURES
        ),
        attempted: Boolean((storm.captureAttempts || {})[playerId]),
        captured: Boolean(mine),
        capturesLeft: Math.max(0, MAX_CAPTURES - done),
        maxCaptures: MAX_CAPTURES,
        claimedBy: (storm.captures || []).map((x) => x.username),
        mySide,
        onWinningSide: winningSide != null && mySide === winningSide,
        odds: winningSide != null && mySide === winningSide ? CAPTURE_RATE_WINNING : CAPTURE_RATE_LOSING,
        cellCost: CAPTURE_CELL_COST,
      };
    })(),
  };
}

// Eligible droids for the storm team picker.
function teamCandidates(playerId) {
  return rift.teamCandidates(playerId);
}

module.exports = {
  StormError,
  MAX_PARTICIPANTS,
  TEAM_SIZE,
  MAX_CAPTURES,
  SOVEREIGN_NAME,
  storms,
  activeStorm,
  stormById,
  openStorm,
  join,
  attack,
  captureSovereign,
  resolve,
  tick,
  viewFor,
  teamCandidates,
  sideOfDroid,
};
