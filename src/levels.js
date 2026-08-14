// levels.js
//
// Player XP, Levels 0-20, and the Re-Boot prestige loop.
//
// The level.pdf asked for everything here to be configurable rather
// than hard-coded, so every number lives in the CONFIG block at the top
// and nothing below it contains a magic value. Extending past Re-Boot
// 10, changing the XP curve, or adding a new XP-earning action is a
// data edit, not a code change.

const db = require('./db');

// ============================================================
// CONFIG — everything tunable lives here
// ============================================================

// XP required to go from level N to N+1. Index 0 = level 0 -> 1.
// Straight from the supplied table. Total to reach 20 is 145,200.
const XP_PER_LEVEL = [
  1000, 1200, 1450, 1750, 2100, 2500, 3000, 3600, 4300, 5100,
  6000, 7000, 8200, 9500, 11000, 12500, 14000, 15500, 17000, 18500,
];

const MAX_LEVEL = XP_PER_LEVEL.length; // 20
const STARTING_LEVEL = 0;              // confirmed: players start at 0

// Which actions grant XP, and how much. 1 XP per qualifying action as
// specified. Passive crystal generation is deliberately absent — it
// isn't an action and would let players idle their way to Level 20.
const XP_ACTIONS = {
  capture: 1,
  hatch: 1,
  battleWin: 1,
  minigameComplete: 1,
  trade: 1,
  evolve: 1,
  depotUse: 1,
};

// Milestone rewards. Keyed by level.
const LEVEL_REWARDS = {
  5:  { crystals: 5000 },
  10: { crystals: 15000, materials: { novaChips: 5, paint: 5, energyTubes: 3 } },
  15: { crystals: 30000, materials: { novaChips: 10, paint: 10, augmentCores: 2, beacons: 3 } },
  20: { crystals: 50000, unlocksReboot: true },
};

const MAX_REBOOTS = 10;
const REBOOT_BONUS_PERCENT = 0.02; // +2% per re-boot

// What a Re-Boot destroys and what it preserves.
//
// Confirmed rules: the player loses every caught droid and all
// materials; they keep Dex progress and achievements.
//
// Cosmetics are on the KEEP list despite being "owned items", because
// the Galactic cosmetic sets are gated behind having re-booted 5+
// times. If Re-Boot wiped cosmetics, that set could never be worn —
// reaching 5 re-boots would destroy it five times over. Pad level and
// unlocked workshop slots are kept for the same reason the Dex is:
// they're progression infrastructure, not collection.
const REBOOT_WIPES = {
  droids: true,
  crystals: true,
  materials: true,       // paint, novaChips, cubes, tokens, everything
  workshopAssignments: true,
  eggs: true,
};
const REBOOT_KEEPS = {
  dexProgress: true,
  achievements: true,
  achievementProgress: true,
  cosmetics: true,       // required for the Galactic 5+ re-boot gate
  outfits: true,
  padLevel: true,
  workshopSlotsUnlocked: true,
  guildMembership: true,
};

// Materials wiped on Re-Boot. Listed explicitly rather than inferred so
// a new currency can't silently survive a Re-Boot by being forgotten.
const WIPED_MATERIAL_FIELDS = [
  'paint', 'novaChips', 'energyTubes', 'repairKits', 'beacons',
  'augmentCores', 'padRam', 'lumeCells', 'apexCubes',
  'titanTokens', 'guildTokens', 'joyCoins',
];

// A Re-Boot costs the player everything they own for a +2% bonus.
// Without a hand back down, most players will read that trade and never
// press the button. This bundle is handed out immediately after a
// Re-Boot so the climb restarts with something in hand.
const REBOOT_STARTER_BUNDLE = {
  crystals: 10000,
  materials: { repairKits: 2, energyTubes: 2, paint: 3 },
};

// ============================================================
// LOGIC
// ============================================================

class LevelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function xpToNext(level) {
  if (level >= MAX_LEVEL) return null;
  return XP_PER_LEVEL[level];
}

function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level && i < XP_PER_LEVEL.length; i++) total += XP_PER_LEVEL[i];
  return total;
}

// Awards XP for a completed action and handles any resulting level-ups.
// Returns null when nothing happened, so callers can cheaply skip UI
// work — this is invoked from hot paths like capture.
function awardXp(playerId, action, amount) {
  const player = db.players.get(playerId);
  if (!player) return null;

  const rawGain = amount != null ? amount : (XP_ACTIONS[action] || 0);
  if (!rawGain) return null;
  const gain = Math.max(1, Math.round(rawGain * db.rateMultiplier('xp')));
  if (player.playerLevel >= MAX_LEVEL) {
    // Still track lifetime XP past the cap — Re-Boot resets the level
    // but lifetime is useful for achievements and leaderboards.
    player.lifetimeXp = (player.lifetimeXp || 0) + gain;
    return null;
  }

  player.playerXp = (player.playerXp || 0) + gain;
  player.lifetimeXp = (player.lifetimeXp || 0) + gain;

  const levelsGained = [];
  let need = xpToNext(player.playerLevel || 0);
  while (need !== null && player.playerXp >= need) {
    player.playerXp -= need;
    player.playerLevel = (player.playerLevel || 0) + 1;
    levelsGained.push(player.playerLevel);
    grantLevelReward(player, player.playerLevel);
    need = xpToNext(player.playerLevel);
  }

  if (!levelsGained.length) return null;
  return {
    levelsGained,
    newLevel: player.playerLevel,
    rewards: levelsGained.map((lv) => ({ level: lv, reward: LEVEL_REWARDS[lv] || null })).filter((r) => r.reward),
    rebootUnlocked: player.playerLevel >= MAX_LEVEL,
  };
}

function grantLevelReward(player, level) {
  const reward = LEVEL_REWARDS[level];
  if (!reward) return;
  if (reward.crystals) {
    player.crystalBalance = (player.crystalBalance || 0) + reward.crystals;
    db.crystalTransactions.push({
      id: db.nextId(), playerId: player.id, amount: reward.crystals,
      source: `level_${level}_reward`, createdAt: Date.now(),
    });
  }
  if (reward.materials) {
    Object.entries(reward.materials).forEach(([k, v]) => {
      player[k] = (player[k] || 0) + v;
    });
  }
  player.unlockedLevelBadges = player.unlockedLevelBadges || [];
  if (!player.unlockedLevelBadges.includes(level)) player.unlockedLevelBadges.push(level);
}

// Every badge in the game, earned or not, so the UI can show the full
// ladder greyed out rather than only the four milestones a player has
// hit. Also reports which one is currently set as their player icon.
function allBadgesFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new LevelError('NO_PLAYER', 'Player not found');
  const level = player.playerLevel || 0;
  const reboots = player.rebootCount || 0;

  const badges = [];
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    badges.push({
      id: 'lv' + String(lv).padStart(3, '0'),
      type: 'level',
      label: 'Level ' + lv,
      icon: 'lv' + String(lv).padStart(3, '0') + '.png',
      folder: 'levels',
      earned: level >= lv,
      requirement: `Reach Level ${lv}`,
    });
  }
  for (let rb = 1; rb <= MAX_REBOOTS; rb++) {
    badges.push({
      id: 'rb' + String(rb).padStart(3, '0'),
      type: 'reboot',
      label: 'Re-Boot ' + rb,
      icon: 'rb' + String(rb).padStart(3, '0') + '.png',
      folder: 'levels',
      earned: reboots >= rb,
      requirement: `Complete ${rb} Re-Boot${rb === 1 ? '' : 's'}`,
    });
  }

  // Achievement badges: one per achievement, earned at any tier.
  try {
    const ach = require('./achievements');
    const unlocked = player.achievementsUnlocked || {};
    ach.ACHIEVEMENTS.forEach((a) => {
      badges.push({
        id: a.id,
        type: 'achievement',
        label: a.name,
        icon: a.icon,
        folder: 'achievements',
        earned: unlocked[a.id] !== undefined && unlocked[a.id] >= 0,
        requirement: a.description,
      });
    });
  } catch (e) {}

  return { badges, selectedBadgeId: player.playerBadgeId || null };
}

function setPlayerBadge(playerId, badgeId) {
  const player = db.players.get(playerId);
  if (!player) throw new LevelError('NO_PLAYER', 'Player not found');
  if (badgeId === null || badgeId === '') {
    player.playerBadgeId = null;
    return allBadgesFor(playerId);
  }
  const { badges } = allBadgesFor(playerId);
  const badge = badges.find((b) => b.id === badgeId);
  if (!badge) throw new LevelError('NO_BADGE', 'Unknown badge');
  if (!badge.earned) throw new LevelError('NOT_EARNED', `${badge.label} isn't unlocked yet — ${badge.requirement}`);
  player.playerBadgeId = badgeId;
  player.playerBadgeIcon = badge.icon;
  player.playerBadgeFolder = badge.folder;
  return allBadgesFor(playerId);
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new LevelError('NO_PLAYER', 'Player not found');
  const level = player.playerLevel || 0;
  const need = xpToNext(level);
  return {
    level,
    xp: player.playerXp || 0,
    xpToNext: need,
    lifetimeXp: player.lifetimeXp || 0,
    maxLevel: MAX_LEVEL,
    progressPercent: need ? Math.round(((player.playerXp || 0) / need) * 100) : 100,
    rebootCount: player.rebootCount || 0,
    maxReboots: MAX_REBOOTS,
    canReboot: level >= MAX_LEVEL && (player.rebootCount || 0) < MAX_REBOOTS,
    crystalBonusPercent: Math.ceil((player.rebootCount || 0) / 2) * REBOOT_BONUS_PERCENT * 100,
    materialBonusPercent: Math.floor((player.rebootCount || 0) / 2) * REBOOT_BONUS_PERCENT * 100,
    unlockedLevelBadges: player.unlockedLevelBadges || [],
    nextRewardLevel: [5, 10, 15, 20].find((l) => l > level) || null,
    levelRewards: LEVEL_REWARDS,
  };
}

// Two-step on purpose: this is the single most destructive action in
// the game, so the caller must pass an explicit confirmation flag. A
// mis-fired request cannot wipe an account.
function reboot(playerId, confirm) {
  const player = db.players.get(playerId);
  if (!player) throw new LevelError('NO_PLAYER', 'Player not found');
  if ((player.playerLevel || 0) < MAX_LEVEL) {
    throw new LevelError('NOT_MAX_LEVEL', `Re-Boot unlocks at Level ${MAX_LEVEL}`);
  }
  if ((player.rebootCount || 0) >= MAX_REBOOTS) {
    throw new LevelError('MAX_REBOOTS', `You've reached the maximum of ${MAX_REBOOTS} Re-Boots`);
  }
  if (confirm !== true) {
    throw new LevelError('CONFIRM_REQUIRED', 'Re-Boot must be explicitly confirmed');
  }

  const summary = { droidsLost: 0, crystalsLost: Math.floor(player.crystalBalance || 0) };

  // Droids: gone. Dex entries are stored separately and untouched, so
  // the player keeps every species they've ever recorded.
  for (const [id, droid] of db.ownedDroids.entries()) {
    if (droid.playerId === playerId) {
      db.ownedDroids.delete(id);
      summary.droidsLost++;
    }
  }
  // Clear workshop assignments left pointing at deleted droids.
  db.workshopSlots.forEach((slot) => {
    if (slot.playerId === playerId) slot.droidId = null;
  });
  // Eggs and incubation go too.
  if (db.eggs) {
    for (const [id, egg] of db.eggs.entries()) {
      if (egg.playerId === playerId) db.eggs.delete(id);
    }
  }
  if (db.processorSlots) {
    db.processorSlots.forEach((slot) => {
      if (slot.playerId === playerId) { slot.eggId = null; slot.startedAt = null; }
    });
  }

  player.crystalBalance = 0;
  WIPED_MATERIAL_FIELDS.forEach((field) => { player[field] = 0; });
  player.companionDroidId = null;
  player.hasStarterDroid = false;

  player.playerLevel = STARTING_LEVEL;
  player.playerXp = 0;
  player.rebootCount = (player.rebootCount || 0) + 1;
  player.lastRebootAt = Date.now();

  // Hand back the starter bundle so the climb restarts with something.
  player.crystalBalance = REBOOT_STARTER_BUNDLE.crystals;
  Object.entries(REBOOT_STARTER_BUNDLE.materials).forEach(([k, v]) => {
    player[k] = (player[k] || 0) + v;
  });

  player.unlockedRebootBadges = player.unlockedRebootBadges || [];
  if (!player.unlockedRebootBadges.includes(player.rebootCount)) {
    player.unlockedRebootBadges.push(player.rebootCount);
  }

  return {
    ...statusFor(playerId),
    rebootSummary: summary,
    starterBundle: REBOOT_STARTER_BUNDLE,
  };
}

module.exports = {
  XP_PER_LEVEL,
  XP_ACTIONS,
  LEVEL_REWARDS,
  MAX_LEVEL,
  MAX_REBOOTS,
  REBOOT_BONUS_PERCENT,
  REBOOT_WIPES,
  REBOOT_KEEPS,
  WIPED_MATERIAL_FIELDS,
  REBOOT_STARTER_BUNDLE,
  awardXp,
  statusFor,
  allBadgesFor,
  setPlayerBadge,
  reboot,
  xpToNext,
  totalXpForLevel,
  LevelError,
};
