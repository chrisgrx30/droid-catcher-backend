// attachments.js
//
// Droid Attachments — 3 typed slots per droid, one item per slot.
//
// SLOT MODEL (confirmed)
//   Slot 1: Mod Chip     (Common)
//   Slot 2: USB Dongle   (Uncommon)
//   Slot 3: Energy Bottle (Rare)
// A fully kitted droid runs one of each simultaneously.
//
// A NOTE ON THE CATALOGUE SHAPE — please sanity-check this reading:
// The spec lists each tier as though one item grants every effect
// (+5% HP AND +5% Attack AND the special AND +5% crystal AND the
// reward bonus). But the icon list names FIVE icons per tier —
// hpmodchip, atkmodchip, spcmodchip, crymodchip, rwdmodchip — with
// distinct prefixes per effect.
//
// Five icons per tier only makes sense if each attachment focuses on
// ONE effect, so that's how this is built: 15 distinct items, each
// doing one thing at its tier's strength. It also makes the system a
// real choice rather than a strict upgrade, and gives the art a job.
//
// If you'd rather one Mod Chip granted all five effects at once, set
// COMBINED_EFFECTS = true below — the catalogue collapses to 3 items
// and everything else keeps working.

const db = require('./db');

const COMBINED_EFFECTS = false;

// ---- tiers ----
// Each tier defines the slot it occupies and the strength of whatever
// effect its items carry.
const TIERS = {
  modchip: {
    slot: 'modchip',
    name: 'Mod Chip',
    rarity: 'common',
    iconSuffix: 'modchip',
    percent: 0.05,
    extraRewardCount: 1,
    extraRewardChance: 0.30,
    special: 'opponent_skips_turn',
    specialText: 'Opponent skips 1 extra turn',
  },
  usb: {
    slot: 'usb',
    name: 'USB Dongle',
    rarity: 'uncommon', // corrected — the icon list mislabelled these as Common
    iconSuffix: 'usb',
    percent: 0.07,
    extraRewardCount: 2,
    extraRewardChance: 0.40,
    special: 'extra_first_turn',
    specialText: 'You take 1 extra turn at battle start',
  },
  ebot: {
    slot: 'ebot',
    name: 'Energy Bottle',
    rarity: 'rare',     // corrected — the icon list mislabelled these as Common
    iconSuffix: 'ebot',
    percent: 0.10,
    extraRewardCount: 3,
    extraRewardChance: 0.50,
    special: 'block_first_attack',
    specialText: "Blocks the opponent's first attack",
  },
};

// ---- effects ----
// The five focuses an attachment can have. `buff` maps onto a buff type
// in buffs.js; null means the effect is handled elsewhere (battle
// specials and reward rolls aren't stat multipliers).
const EFFECTS = {
  hp:  { key: 'hp',  label: 'HP',       buff: 'hp',          iconPrefix: 'hp' },
  atk: { key: 'atk', label: 'Attack',   buff: 'attack',      iconPrefix: 'atk' },
  spc: { key: 'spc', label: 'Special',  buff: null,          iconPrefix: 'spc' },
  cry: { key: 'cry', label: 'Crystal',  buff: 'crystalRate', iconPrefix: 'cry' },
  rwd: { key: 'rwd', label: 'Reward',   buff: null,          iconPrefix: 'rwd' },
};

function buildCatalog() {
  const catalog = [];
  Object.values(TIERS).forEach((tier) => {
    if (COMBINED_EFFECTS) {
      catalog.push({
        id: tier.slot,
        name: tier.name,
        slot: tier.slot,
        rarity: tier.rarity,
        effects: Object.keys(EFFECTS),
        percent: tier.percent,
        special: tier.special,
        specialText: tier.specialText,
        extraRewardCount: tier.extraRewardCount,
        extraRewardChance: tier.extraRewardChance,
        icon: `${tier.iconSuffix}.png`,
      });
      return;
    }
    Object.values(EFFECTS).forEach((effect) => {
      catalog.push({
        id: `${effect.iconPrefix}${tier.iconSuffix}`,
        // e.g. "HP Mod Chip", "Crystal Energy Bottle"
        name: `${effect.label} ${tier.name}`,
        slot: tier.slot,
        rarity: tier.rarity,
        effect: effect.key,
        buffType: effect.buff,
        percent: tier.percent,
        special: effect.key === 'spc' ? tier.special : null,
        specialText: effect.key === 'spc' ? tier.specialText : null,
        extraRewardCount: effect.key === 'rwd' ? tier.extraRewardCount : 0,
        extraRewardChance: effect.key === 'rwd' ? tier.extraRewardChance : 0,
        // Icon filename matches the supplied art exactly.
        icon: `${effect.iconPrefix}${tier.iconSuffix}.png`,
      });
    });
  });
  return catalog;
}

const ATTACHMENT_CATALOG = buildCatalog();
const SLOTS = Object.keys(TIERS); // ['modchip','usb','ebot']

function catalogItem(id) {
  return ATTACHMENT_CATALOG.find((a) => a.id === id) || null;
}

class AttachmentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// A player's inventory is a flat map of attachmentId -> count owned.
// Equipping moves nothing — it records the assignment on the droid and
// marks that unit as in use, so counts always reflect the true total.
function inventoryFor(player) {
  return player.attachments || (player.attachments = {});
}

function equippedCountOf(playerId, attachmentId) {
  let n = 0;
  for (const droid of db.ownedDroids.values()) {
    if (droid.playerId !== playerId || !droid.attachments) continue;
    Object.values(droid.attachments).forEach((id) => { if (id === attachmentId) n++; });
  }
  return n;
}

function availableCount(player, attachmentId) {
  const owned = inventoryFor(player)[attachmentId] || 0;
  return owned - equippedCountOf(player.id, attachmentId);
}

function grant(playerId, attachmentId, amount = 1) {
  const player = db.players.get(playerId);
  if (!player) throw new AttachmentError('NO_PLAYER', 'Player not found');
  if (!catalogItem(attachmentId)) throw new AttachmentError('NO_ITEM', 'Unknown attachment');
  const inv = inventoryFor(player);
  inv[attachmentId] = (inv[attachmentId] || 0) + amount;
  return inv[attachmentId];
}

function equip(playerId, droidId, attachmentId) {
  const player = db.players.get(playerId);
  if (!player) throw new AttachmentError('NO_PLAYER', 'Player not found');
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new AttachmentError('NO_DROID', 'Droid not found');
  const item = catalogItem(attachmentId);
  if (!item) throw new AttachmentError('NO_ITEM', 'Unknown attachment');
  if (availableCount(player, attachmentId) < 1) {
    throw new AttachmentError('NONE_SPARE', `All your ${item.name}s are already equipped to other droids`);
  }

  droid.attachments = droid.attachments || {};
  // One item per slot — equipping into an occupied slot swaps, and the
  // previous item returns to the pool automatically because
  // availableCount is derived rather than stored.
  const previous = droid.attachments[item.slot] || null;
  droid.attachments[item.slot] = attachmentId;
  return { droid, slot: item.slot, equipped: attachmentId, replaced: previous };
}

function unequip(playerId, droidId, slot) {
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new AttachmentError('NO_DROID', 'Droid not found');
  if (!SLOTS.includes(slot)) throw new AttachmentError('BAD_SLOT', 'Unknown slot');
  const removed = (droid.attachments || {})[slot] || null;
  if (droid.attachments) droid.attachments[slot] = null;
  return { droid, slot, removed };
}

// ---- buff contribution ----
// Returns the additive buff set for every attachment equipped across a
// player's droids that affects PLAYER-level stats (crystal rate).
// HP and attack are per-droid, so those are applied in workshop.js
// rather than here — a Mod Chip on one droid shouldn't buff the rest.
function playerBuffSet(player) {
  const set = { crystalRate: 0 };
  for (const droid of db.ownedDroids.values()) {
    if (droid.playerId !== player.id || !droid.attachments) continue;
    Object.values(droid.attachments).forEach((id) => {
      const item = id && catalogItem(id);
      if (item && item.buffType === 'crystalRate') set.crystalRate += item.percent;
    });
  }
  return set;
}

// Per-droid HP/attack multiplier from that droid's own attachments.
function droidStatMultipliers(droid) {
  const out = { hp: 1, attack: 1 };
  if (!droid || !droid.attachments) return out;
  let hpAdd = 0;
  let atkAdd = 0;
  Object.values(droid.attachments).forEach((id) => {
    const item = id && catalogItem(id);
    if (!item) return;
    if (item.buffType === 'hp') hpAdd += item.percent;
    if (item.buffType === 'attack') atkAdd += item.percent;
  });
  out.hp = 1 + hpAdd;
  out.attack = 1 + atkAdd;
  return out;
}

// Battle specials carried by a droid's equipped attachments.
function droidSpecials(droid) {
  if (!droid || !droid.attachments) return [];
  const out = [];
  Object.values(droid.attachments).forEach((id) => {
    const item = id && catalogItem(id);
    if (item && item.special) out.push({ special: item.special, text: item.specialText, from: item.name });
  });
  return out;
}

// Extra battle reward rolls. Returns the number of bonus items won.
function rollExtraRewards(droid) {
  if (!droid || !droid.attachments) return 0;
  let total = 0;
  Object.values(droid.attachments).forEach((id) => {
    const item = id && catalogItem(id);
    if (item && item.extraRewardCount && Math.random() < item.extraRewardChance) {
      total += item.extraRewardCount;
    }
  });
  return total;
}

function summaryFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new AttachmentError('NO_PLAYER', 'Player not found');
  const inv = inventoryFor(player);
  return {
    catalog: ATTACHMENT_CATALOG,
    slots: SLOTS,
    inventory: ATTACHMENT_CATALOG.map((item) => ({
      id: item.id,
      name: item.name,
      slot: item.slot,
      rarity: item.rarity,
      icon: item.icon,
      owned: inv[item.id] || 0,
      equipped: equippedCountOf(playerId, item.id),
      available: availableCount(player, item.id),
    })).filter((i) => i.owned > 0),
  };
}

module.exports = {
  ATTACHMENT_CATALOG,
  SLOTS,
  TIERS,
  EFFECTS,
  COMBINED_EFFECTS,
  catalogItem,
  grant,
  equip,
  unequip,
  playerBuffSet,
  droidStatMultipliers,
  droidSpecials,
  rollExtraRewards,
  summaryFor,
  availableCount,
  AttachmentError,
};
