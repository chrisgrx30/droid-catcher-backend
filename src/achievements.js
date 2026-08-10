// achievements.js
//
// All 56 achievements, four tiers each (Bronze / Silver / Gold / Gem).
//
// HOW PROGRESS WORKS
// Every achievement is a COUNTER plus a set of thresholds. Counters are
// stored on the player as `achievementProgress[id]` and only ever go up.
//
// That "only ever go up" property is deliberate and load-bearing: the
// user's Re-Boot rule wipes every droid and material but explicitly
// KEEPS achievements. If A023 (Droid Hoarder) read the player's current
// droid count, a Re-Boot would silently reset it to zero and revoke a
// tier they'd already earned. So counters like "most droids owned at
// once" are stored as high-water marks, updated on the way up and never
// recalculated from live state.
//
// BUFFS
// Each tier unlocked adds its buff percentage to player.achievementBuffs,
// which buffs.js reads as one of its stacking sources. The engine caps
// the total, so 56 achievements all granting catch rate can't compound
// past the ceiling — see buffs.js BUFF_CAPS.
//
// UNBUILT TRACKERS
// Some achievements in the source table depend on systems that don't
// exist yet (crafting, social actions, minigame high scores). Those are
// defined with `pending: true` — they appear in the UI as "coming soon"
// rather than being silently missing or, worse, permanently stuck at
// zero with no explanation.

const db = require('./db');

const TIER_NAMES = ['bronze', 'silver', 'gold', 'gem'];

// [id, name, description, counterKey, [bronze, silver, gold, gem], buffType, buffPercentPerTier, pending?]
//
// buffPercentPerTier is the value from the design table. It's awarded
// PER TIER, so an achievement at 0.5% grants 0.5% at Bronze and a
// further 0.5% at each tier above — 2% for all four.
const ACHIEVEMENTS = [
  ['A001', 'Droid Collector', 'Catch different droids', 'uniqueDroids', [10, 30, 75, 150], 'catchRate', 0.005],
  ['A002', 'Dark Side Hunter', 'Catch different Dark droids', 'uniqueDark', [5, 15, 40, 80], 'catchRate', 0.005],
  ['A003', 'Light Side Hunter', 'Catch different Light droids', 'uniqueLight', [5, 15, 40, 80], 'catchRate', 0.005],
  ['A004', 'Droid Master', 'Catch droids overall', 'totalCaught', [50, 250, 1000, 5000], 'catchRate', 0.005],
  ['A005', 'Rare Hunter', 'Catch Rare or higher', 'rarePlusCaught', [5, 25, 100, 500], 'catchRate', 0.005],
  ['A006', 'Legendary Hunter', 'Catch Legendary droids', 'legendaryCaught', [1, 5, 25, 100], 'catchRate', 0.005],
  ['A007', 'Cosmic Hunter', 'Catch Cosmic droids', 'cosmicCaught', [1, 3, 10, 50], 'catchRate', 0.005],
  ['A008', 'Galactic Hunter', 'Collect Galactic droids', 'galacticCaught', [1, 2, 5, 10], 'catchRate', 0.005],
  ['A009', 'Variant Hunter', 'Catch Rusty/Platinum droids', 'uniqueVariants', [20, 100, 250, 500], 'variantOdds', 0.02],
  ['A010', 'Paint Collector', 'Paint Rusty droids', 'droidsPainted', [1, 5, 20, 50], 'materialReward', 0.10],
  ['A011', 'Platinum Collector', 'Catch Platinum droids', 'platinumCaught', [1, 3, 10, 25], 'variantOdds', 0.02],
  ['A012', 'Egg Cracker', 'Hatch eggs', 'eggsHatched', [5, 25, 100, 500], 'hatchSpeed', 0.10],
  ['A013', 'Egg Collector', 'Hatch different droids', 'uniqueEggDroids', [3, 10, 25, 50], 'hatchSpeed', 0.10],
  ['A014', 'Battle Droid', 'Win battles', 'battlesWon', [5, 25, 100, 500], 'hp', 0.02],
  ['A015', 'Battle Veteran', 'Win consecutive battles', 'battleWinStreak', [3, 5, 10, 20], 'attack', 0.02],
  ['A016', 'Battle Champion', 'Beat stronger opponents', 'strongerDefeated', [1, 10, 50, 200], 'attack', 0.05],
  ['A017', 'MiniGame Master', 'Complete minigames', 'minigamesCompleted', [100, 150, 250, 1000], 'minigameOdds', 0.02],
  ['A018', 'MiniGame Champion', 'Achieve high scores', 'minigameHighScores', [3, 10, 30, 100], 'minigameOdds', 0.02, true],
  ['A019', 'Trader', 'Complete trades', 'tradesCompleted', [5, 25, 100, 500], 'materialReward', 0.02],
  ['A020', 'Master Trader', 'Trade different droids', 'uniqueDroidsTraded', [3, 10, 25, 50], 'materialReward', 0.02],
  ['A021', 'Explorer', 'Catch in different locations', 'uniqueLocations', [3, 10, 25, 50], 'materialReward', 0.02],
  ['A022', 'World Explorer', 'Catch across regions', 'uniqueRegions', [2, 5, 15, 30], 'materialReward', 0.02],
  ['A023', 'Droid Hoarder', 'Own droids', 'maxDroidsOwned', [10, 50, 150, 500], 'crystalRate', 0.02],
  ['A024', 'Maximum Voids', 'Own max-level droids at once', 'maxLevelDroidsOwned', [5, 25, 75, 150], 'hp', 0.01],
  ['A025', 'Evolution Engineer', 'Evolve droids', 'evolutionsCompleted', [3, 15, 50, 200], 'evolutionCost', 0.05],
  ['A026', 'Evolution Collector', 'Complete evolution lines', 'evolutionLinesCompleted', [1, 5, 15, 30], 'evolutionCost', 0.02],
  ['A027', 'Crystal Miner', 'Collect crystals', 'lifetimeCrystalsEarned', [1000000, 1500000, 5000000, 999999999], 'crystalRate', 0.02],
  ['A028', 'Crystal Spender', 'Spend crystals', 'lifetimeCrystalsSpent', [1000000, 1500000, 5000000, 999999999], 'shopCost', 0.10],
  ['A029', 'Depot Regular', 'Use the Depot', 'depotVisits', [10, 100, 500, 2500], 'shopCost', 0.10],
  ['A030', 'Depot Collector', 'Obtain Depot rewards', 'depotRewards', [300, 1000, 2500, 5000], 'shopCost', 0.10],
  ['A031', 'Material Hoarder', 'Collect materials', 'uniqueMaterials', [5, 15, 30, 60], 'shopCost', 0.10],
  ['A032', 'Crafting Droid', 'Craft items', 'itemsCrafted', [5, 25, 100, 500], 'shopCost', 0.10, true],
  ['A033', 'Daily Droid', 'Play on different days', 'uniqueActiveDays', [7, 30, 100, 365], 'hp', 0.10],
  ['A034', 'Dedicated Hunter', 'Catch on consecutive days', 'consecutiveDays', [3, 7, 30, 100], 'hp', 0.05],
  ['A035', 'Droid Streak', 'Maintain a catch streak', 'catchStreakDays', [3, 7, 30, 100], 'crystalRate', 0.01],
  ['A036', 'Signal Seeker', 'Find spawned droids', 'droidsDiscovered', [2500, 10000, 50000, 2500000], 'variantOdds', 0.05],
  ['A037', 'Capture Expert', 'Consecutive successful captures', 'captureStreak', [10, 25, 50, 100], 'minigameOdds', 0.01],
  ['A038', 'First Contact', 'Catch each rarity', 'raritiesDiscovered', [2, 4, 5, 6], 'evolutionCost', 0.02],
  ['A039', 'Dark Collection', 'Complete the Dark collection', 'darkCollectionPercent', [25, 50, 75, 100], 'evolutionCost', 0.02],
  ['A040', 'Light Collection', 'Complete the Light collection', 'lightCollectionPercent', [25, 50, 75, 100], 'evolutionCost', 0.02],
  ['A041', 'Balance Keeper', 'Catch both sides', 'balancedCatches', [50, 100, 250, 500], 'hp', 0.005],
  ['A042', 'Complete Collection', 'Complete the collection', 'dexPercent', [25, 50, 75, 100], 'hp', 0.005],
  ['A043', 'Event Hunter', 'Catch event droids', 'eventDroidsCaught', [1, 5, 15, 30], 'hp', 0.005],
  ['A044', 'Event Veteran', 'Participate in events', 'eventsParticipated', [1, 5, 10, 25], 'hp', 0.005],
  ['A045', 'Event Collector', 'Collect unique event droids', 'uniqueEventDroids', [2, 5, 15, 30], 'hp', 0.005],
  ['A046', 'Team Player', 'Complete team activities', 'teamActivities', [5, 25, 100, 500], 'hp', 0.005],
  ['A047', 'Social Droid', 'Social interactions', 'socialActivities', [5, 25, 100, 500], 'hp', 0.005, true],
  ['A048', 'Friendship Builder', 'Play with friends', 'friendActivities', [5, 25, 100, 500], 'materialReward', 0.10],
  ['A049', 'Droid Specialist', 'Catch the same species', 'sameSpeciesCaught', [5, 25, 100, 500], 'crystalRate', 0.005],
  ['A050', 'Droid Variety', 'Catch different species', 'uniqueSpecies', [5, 20, 50, 100], 'crystalRate', 0.005],
  ['A051', 'Perfect Capture', 'Perfect captures (100% accuracy)', 'perfectCaptures', [3, 10, 50, 200], 'crystalRate', 0.005],
  ['A052', 'Speed Catcher', 'Fast captures', 'fastCaptures', [50, 250, 1000, 5000], 'crystalRate', 0.005],
  ['A053', 'Night Hunter', 'Catch at night', 'nightCatches', [5, 25, 100, 500], 'crystalRate', 0.005],
  ['A054', 'Day Hunter', 'Catch during the day', 'dayCatches', [5, 25, 100, 500], 'crystalRate', 0.005],
  ['A055', 'Distance Hunter', 'Catch across distances (km)', 'distanceKm', [5, 25, 100, 500], 'crystalRate', 0.005],
  // A056's buff column was blank in the source table. Matched to the
  // rest of the A049-A055 block, which is uniformly crystalRate 0.5%.
  ['A056', 'Long-Distance Droid', 'Catch far from your last location', 'longDistanceCatches', [1, 5, 25, 100], 'crystalRate', 0.005],
];

const BY_ID = {};
const CATALOG = ACHIEVEMENTS.map(([id, name, description, counter, thresholds, buffType, buffPercent, pending]) => {
  const entry = {
    id, name, description, counter, thresholds, buffType, buffPercent,
    pending: Boolean(pending),
    // achi001.png … achi056.png
    icon: 'achi' + id.slice(1) + '.png',
  };
  BY_ID[id] = entry;
  return entry;
});

const BY_COUNTER = {};
CATALOG.forEach((a) => {
  if (!BY_COUNTER[a.counter]) BY_COUNTER[a.counter] = [];
  BY_COUNTER[a.counter].push(a);
});

function progressOf(player) {
  return player.achievementProgress || (player.achievementProgress = {});
}

function unlockedOf(player) {
  return player.achievementsUnlocked || (player.achievementsUnlocked = {});
}

function tierIndexFor(entry, value) {
  let tier = -1;
  entry.thresholds.forEach((t, i) => { if (value >= t) tier = i; });
  return tier;
}

// Recomputes the player's achievement buff totals from scratch. Called
// after any unlock, so a mis-added buff can't drift — the totals are
// always derivable from what's unlocked.
function recomputeBuffs(player) {
  const totals = {};
  const unlocked = unlockedOf(player);
  CATALOG.forEach((entry) => {
    const tier = unlocked[entry.id];
    if (tier === undefined || tier < 0) return;
    // Buff is granted per tier, cumulatively.
    const amount = entry.buffPercent * (tier + 1);
    totals[entry.buffType] = (totals[entry.buffType] || 0) + amount;
  });
  player.achievementBuffs = totals;
  return totals;
}

// The single entry point for progress. Everything else in the codebase
// calls this.
//
// mode 'increment' adds to the counter; mode 'max' keeps the highest
// value ever seen (used for high-water marks that must survive Re-Boot).
function track(playerId, counter, amount = 1, mode = 'increment') {
  const player = db.players.get(playerId);
  if (!player) return null;
  const entries = BY_COUNTER[counter];
  if (!entries || !entries.length) return null;

  const progress = progressOf(player);
  const before = progress[counter] || 0;
  const after = mode === 'max' ? Math.max(before, amount) : before + amount;
  if (after === before) return null;
  progress[counter] = after;

  const newlyUnlocked = [];
  entries.forEach((entry) => {
    if (entry.pending) return;
    const unlocked = unlockedOf(player);
    const had = unlocked[entry.id] !== undefined ? unlocked[entry.id] : -1;
    const now = tierIndexFor(entry, after);
    if (now > had) {
      unlocked[entry.id] = now;
      for (let t = had + 1; t <= now; t++) {
        newlyUnlocked.push({ id: entry.id, name: entry.name, tier: TIER_NAMES[t], tierIndex: t, icon: entry.icon });
      }
    }
  });

  if (newlyUnlocked.length) recomputeBuffs(player);
  return newlyUnlocked.length ? newlyUnlocked : null;
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  const progress = progressOf(player);
  const unlocked = unlockedOf(player);

  const list = CATALOG.map((entry) => {
    const value = progress[entry.counter] || 0;
    const tier = unlocked[entry.id] !== undefined ? unlocked[entry.id] : -1;
    const nextThreshold = tier + 1 < entry.thresholds.length ? entry.thresholds[tier + 1] : null;
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      pending: entry.pending,
      value,
      tier,
      tierName: tier >= 0 ? TIER_NAMES[tier] : null,
      thresholds: entry.thresholds,
      nextThreshold,
      percentToNext: nextThreshold ? Math.min(100, Math.round((value / nextThreshold) * 100)) : 100,
      buffType: entry.buffType,
      buffPercent: entry.buffPercent,
      earnedBuff: tier >= 0 ? entry.buffPercent * (tier + 1) : 0,
    };
  });

  const totalTiers = CATALOG.filter((a) => !a.pending).length * TIER_NAMES.length;
  const earnedTiers = list.reduce((a, x) => a + (x.pending ? 0 : x.tier + 1), 0);

  return {
    achievements: list,
    tierNames: TIER_NAMES,
    earnedTiers,
    totalTiers,
    completedCount: list.filter((x) => x.tier === TIER_NAMES.length - 1).length,
    totalCount: CATALOG.length,
    pendingCount: CATALOG.filter((a) => a.pending).length,
    buffs: player.achievementBuffs || {},
  };
}

module.exports = {
  ACHIEVEMENTS: CATALOG,
  BY_ID,
  BY_COUNTER,
  TIER_NAMES,
  track,
  statusFor,
  recomputeBuffs,
  tierIndexFor,
};
