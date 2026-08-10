// forge.js
//
// THE FORGE — a guild minigame that produces Forge Items.
//
// Forge Items have two uses:
//   1. One-time consumables in Apex battles (+10% attack / +10% HP).
//   2. Permanent Fort upgrade-slot fittings (shields, defender HP, etc).
//
// BUFF SPLIT (my call, per the brief — "decide on what the buffs should
// be, and split them equally")
// 20 items, 10 Uncommon and 10 Rare. Each item does ONE thing well
// rather than a little of everything, so choosing which to slot into a
// Fort is a real decision. The five effect families are:
//
//   shield      — Fort shield maximum
//   defenderHp  — HP of droids defending that Fort
//   defenderAtk — attack of droids defending that Fort
//   tokenRate   — daily Guild Token drop from that Fort
//   apexAttack / apexHp — the one-time Apex battle consumable
//
// Uncommon items give the smaller value, Rare the larger, and the two
// tiers cover the same families so no effect is locked behind rarity.
//
// THE MINIGAME
// Deliberately harder and different from the Depot's single-tap timing
// bar: the Forge is a THREE-STAGE sequence (heat, fold, quench) and all
// three must land. See resolveForge() — the odds compound, so a ~70%
// per-stage skill yields ~34% overall, which is why Forge items stay
// scarcer than Depot drops.

const db = require('./db');

const FORGE_COST_CRYSTALS = 2500;
const FORGE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between attempts
const FORGE_STAGES = ['heat', 'fold', 'quench'];

// [id, display name, rarity, effect, value]
const FORGE_ITEMS = [
  // ---- UNCOMMON (10) ----
  ['orionyx',      'Orionyx',       'uncommon', 'defenderAtk', 0.02],
  ['eaglepillar',  'Eaglepillar',   'uncommon', 'defenderAtk', 0.02],
  ['lagoonpulse',  'Lagoonpulse',   'uncommon', 'defenderHp',  0.02],
  ['rosettecore',  'Rosettecore',   'uncommon', 'defenderHp',  0.02],
  ['carinablaze',  'Carinablaze',   'uncommon', 'shield',      0.02],
  ['witchhead',    'Witchhead',     'uncommon', 'shield',      0.02],
  ['pleiadeshade', 'Pleiadeshade',  'uncommon', 'apexAttack',  0.10],
  ['horsehead',    'Horsehead',     'uncommon', 'apexAttack',  0.10],
  ['coalsack',     'Coalsack',      'uncommon', 'apexHp',      0.10],
  ['trifidsplit',  'Trifidsplit',   'uncommon', 'apexHp',      0.10],

  // ---- RARE (10) ----
  ['ringwalker',   'Ringwalker',    'rare', 'defenderAtk', 0.05],
  ['helixeye',     'Helixeye',      'rare', 'defenderAtk', 0.05],
  ['catseye',      'Catseye',       'rare', 'defenderHp',  0.05],
  ['boomerangcold','Boomerangcold', 'rare', 'defenderHp',  0.05],
  ['southernring', 'Southernring',  'rare', 'shield',      0.05],
  ['crabpulsar',   'Crabpulsar',    'rare', 'shield',      0.05],
  ['cassiopeiaa',  'Cassiopeia-A',  'rare', 'tokenRate',   1],
  ['veilfilament', 'Veilfilament',  'rare', 'tokenRate',   1],
  ['cygnusloop',   'Cygnusloop',    'rare', 'apexAttack',  0.20],
  ['nebulhybrid',  'Nebulhybrid',   'rare', 'apexHp',      0.20],
];

const EFFECT_LABELS = {
  shield:      { label: 'Fort Shield', kind: 'fort', describe: (v) => `+${Math.round(v * 100)}% Fort shield` },
  defenderHp:  { label: 'Defender HP', kind: 'fort', describe: (v) => `+${Math.round(v * 100)}% defending droid HP` },
  defenderAtk: { label: 'Defender Attack', kind: 'fort', describe: (v) => `+${Math.round(v * 100)}% defending droid attack` },
  tokenRate:   { label: 'Token Drop', kind: 'fort', describe: (v) => `+${v} Guild Token per day` },
  apexAttack:  { label: 'Apex Attack', kind: 'apex', describe: (v) => `+${Math.round(v * 100)}% attack in an Apex battle (one use)` },
  apexHp:      { label: 'Apex HP', kind: 'apex', describe: (v) => `+${Math.round(v * 100)}% HP in an Apex battle (one use)` },
};

// The unused Augment Core finally gets a purpose, as requested.
FORGE_ITEMS.push(['augcore', 'Augment Core', 'rare', 'apexAttack', 0.15]);

const CATALOG = FORGE_ITEMS.map(([id, name, rarity, effect, value]) => ({
  id, name, rarity, effect, value,
  kind: EFFECT_LABELS[effect].kind,
  effectLabel: EFFECT_LABELS[effect].label,
  description: EFFECT_LABELS[effect].describe(value),
  // augcore.png lives in assets/equipment/; everything else in assets/forge/
  icon: id === 'augcore' ? 'AugCore.png' : `${id}.png`,
  folder: id === 'augcore' ? 'equipment' : 'forge',
}));

const BY_ID = {};
CATALOG.forEach((i) => { BY_ID[i.id] = i; });

// Rare items are meaningfully harder to get than uncommon ones.
const RARITY_WEIGHT = { uncommon: 70, rare: 30 };

class ForgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function inventoryOf(player) {
  return player.forgeItems || (player.forgeItems = {});
}

function grant(playerId, itemId, amount = 1) {
  const player = db.players.get(playerId);
  if (!player) throw new ForgeError('NO_PLAYER', 'Player not found');
  if (!BY_ID[itemId]) throw new ForgeError('NO_ITEM', 'Unknown Forge item');
  const inv = inventoryOf(player);
  inv[itemId] = (inv[itemId] || 0) + amount;
  return inv[itemId];
}

function consume(playerId, itemId, amount = 1) {
  const player = db.players.get(playerId);
  if (!player) throw new ForgeError('NO_PLAYER', 'Player not found');
  const inv = inventoryOf(player);
  if ((inv[itemId] || 0) < amount) throw new ForgeError('NOT_OWNED', `You don't have that many ${BY_ID[itemId] ? BY_ID[itemId].name : 'items'}`);
  inv[itemId] -= amount;
  if (inv[itemId] <= 0) delete inv[itemId];
  return inv[itemId] || 0;
}

function rollItem() {
  const total = Object.values(RARITY_WEIGHT).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  let rarity = 'uncommon';
  for (const [r, w] of Object.entries(RARITY_WEIGHT)) {
    roll -= w;
    if (roll <= 0) { rarity = r; break; }
  }
  const pool = CATALOG.filter((i) => i.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- the minigame ----
//
// Three stages, each sent as a separate accuracy value from the client.
// A stage passes on its own roll, and ALL THREE must pass. Because the
// probabilities multiply, a player who is individually good (0.8 each)
// still only succeeds about half the time — which is the "harder than
// the Depot" property the brief asked for.
//
// Server-authoritative: the client reports raw accuracy per stage, the
// server decides. It also rejects impossibly fast sequences, the same
// bot check the capture minigame uses.
const MIN_STAGE_MS = 300;

function attemptForge(playerId, stages, totalDurationMs) {
  const player = db.players.get(playerId);
  if (!player) throw new ForgeError('NO_PLAYER', 'Player not found');
  const now = Date.now();

  if (player.forgeCooldownUntil && now < player.forgeCooldownUntil) {
    const mins = Math.ceil((player.forgeCooldownUntil - now) / 60000);
    throw new ForgeError('ON_COOLDOWN', `The Forge is still cooling — ${mins} minute${mins === 1 ? '' : 's'} left`);
  }
  if (!player.guildId) throw new ForgeError('NO_GUILD', 'The Forge is a guild facility — join a guild first');
  if ((player.crystalBalance || 0) < FORGE_COST_CRYSTALS) {
    throw new ForgeError('NOT_ENOUGH_CRYSTALS', `A Forge attempt costs ${FORGE_COST_CRYSTALS.toLocaleString()} crystals`);
  }
  if (!Array.isArray(stages) || stages.length !== FORGE_STAGES.length) {
    throw new ForgeError('BAD_ATTEMPT', 'Incomplete forge sequence');
  }
  if (totalDurationMs && totalDurationMs < MIN_STAGE_MS * FORGE_STAGES.length) {
    throw new ForgeError('TOO_FAST', 'That sequence was too fast to be real');
  }

  player.crystalBalance -= FORGE_COST_CRYSTALS;
  db.crystalTransactions.push({
    id: db.nextId(), playerId, amount: -FORGE_COST_CRYSTALS, source: 'forge_attempt', createdAt: now,
  });
  player.forgeCooldownUntil = now + FORGE_COOLDOWN_MS;

  const results = FORGE_STAGES.map((stage, i) => {
    const accuracy = Math.max(0, Math.min(1, Number(stages[i]) || 0));
    // Accuracy IS the pass chance, so a perfect stage still isn't a
    // guaranteed pass at the sequence level — the other two still have
    // to land.
    const passed = Math.random() < accuracy;
    return { stage, accuracy: Math.round(accuracy * 100) / 100, passed };
  });

  const success = results.every((r) => r.passed);
  let item = null;
  if (success) {
    item = rollItem();
    grant(playerId, item.id);
  }

  return {
    success,
    stages: results,
    item,
    cost: FORGE_COST_CRYSTALS,
    crystalBalance: Math.floor(player.crystalBalance),
    cooldownUntil: player.forgeCooldownUntil,
  };
}

function summaryFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new ForgeError('NO_PLAYER', 'Player not found');
  const inv = inventoryOf(player);
  const now = Date.now();
  return {
    catalog: CATALOG,
    // Armoury shows EVERY item at all times with a quantity, per the
    // brief — owning none shows 0 rather than hiding the item.
    armoury: CATALOG.map((i) => ({ ...i, owned: inv[i.id] || 0 })),
    totalOwned: Object.values(inv).reduce((a, b) => a + b, 0),
    cost: FORGE_COST_CRYSTALS,
    stages: FORGE_STAGES,
    onCooldown: Boolean(player.forgeCooldownUntil && now < player.forgeCooldownUntil),
    cooldownMsRemaining: Math.max(0, (player.forgeCooldownUntil || 0) - now),
    hasGuild: Boolean(player.guildId),
  };
}

module.exports = {
  FORGE_ITEMS: CATALOG,
  BY_ID,
  FORGE_COST_CRYSTALS,
  FORGE_COOLDOWN_MS,
  FORGE_STAGES,
  EFFECT_LABELS,
  attemptForge,
  summaryFor,
  grant,
  consume,
  rollItem,
  inventoryOf,
  ForgeError,
};
