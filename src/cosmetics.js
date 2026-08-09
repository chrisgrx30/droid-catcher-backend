// cosmetics.js
//
// Player cosmetics — 10 sets x 4 slots, with per-piece stat buffs and a
// four-piece set bonus.
//
// BUFF MAPPING (from the spec, applied exactly):
//   Head + Body -> HP
//   Arms + Legs -> Attack
//
//   Common +2%, Uncommon +4%, Rare +10%, Legendary +15%, Galactic +30%
//
// SET BONUS: wearing all four pieces of one set adds a further +5% to
// BOTH HP and Attack, plus a visual aura the client renders.
//
// These are PLAYER buffs, not per-droid ones — cosmetics are worn by
// the pilot, so they feed the central engine in buffs.js and are capped
// alongside everything else.
//
// GALACTIC GATE: the two Galactic sets can only be EQUIPPED once the
// player has re-booted 5+ times. They can be owned before then — they
// just sit unequippable, which gives the Re-Boot loop a visible goal.
// This is also why Re-Boot preserves cosmetics; see levels.js.

const db = require('./db');

const REQUIRED_REBOOTS_FOR_GALACTIC = 5;

const SLOTS = ['head', 'body', 'arms', 'legs'];

// Which stat each slot buffs.
const SLOT_BUFF = { head: 'hp', body: 'hp', arms: 'attack', legs: 'attack' };

// Per-piece percentage by rarity.
const RARITY_PERCENT = {
  common: 0.02,
  uncommon: 0.04,
  rare: 0.10,
  legendary: 0.15,
  galactic: 0.30,
};

// Four-piece set bonus, applied to both HP and Attack.
const SET_BONUS_PERCENT = 0.05;

// ---- the ten sets ----
// `prefix` matches the supplied art filenames exactly: prefix + slot,
// e.g. Duskraider head is drhead.png.
const SETS = [
  { id: 'sunward',     name: 'Sunward',     prefix: 'sw', rarity: 'common',    alignment: 'light' },
  { id: 'duskraider',  name: 'Duskraider',  prefix: 'dr', rarity: 'common',    alignment: 'dark'  },
  { id: 'aurora',      name: 'Aurora',      prefix: 'ar', rarity: 'uncommon',  alignment: 'light' },
  { id: 'nightshade',  name: 'Nightshade',  prefix: 'ns', rarity: 'uncommon',  alignment: 'dark'  },
  { id: 'solaris',     name: 'Solaris',     prefix: 'sl', rarity: 'rare',      alignment: 'light' },
  { id: 'obsidian',    name: 'Obsidian',    prefix: 'os', rarity: 'rare',      alignment: 'dark'  },
  { id: 'ascendant',   name: 'Ascendant',   prefix: 'ac', rarity: 'legendary', alignment: 'light' },
  { id: 'dominion',    name: 'Dominion',    prefix: 'dm', rarity: 'legendary', alignment: 'dark'  },
  { id: 'astralis',    name: 'Astralis',    prefix: 'at', rarity: 'galactic',  alignment: 'light' },
  { id: 'singularity', name: 'Singularity', prefix: 'sg', rarity: 'galactic',  alignment: 'dark'  },
];

// Piece names, straight from the spec. Falls back to a generated name
// for any set not listed, so adding a set later needs only a SETS entry.
const PIECE_NAMES = {
  sunward:     { head: 'Sunward Cap',        body: 'Sunward Jacket',      arms: 'Sunward Wraps',        legs: 'Sunward Boots' },
  duskraider:  { head: 'Duskraider Hood',    body: 'Duskraider Jacket',   arms: 'Duskraider Wraps',     legs: 'Duskraider Boots' },
  aurora:      { head: 'Aurora Visor',       body: 'Aurora Vest',         arms: 'Aurora Bracers',       legs: 'Aurora Runners' },
  nightshade:  { head: 'Nightshade Mask',    body: 'Nightshade Shell',    arms: 'Nightshade Bracers',   legs: 'Nightshade Treads' },
  solaris:     { head: 'Solaris Helm',       body: 'Solaris Plate',       arms: 'Solaris Guards',       legs: 'Solaris Treads' },
  obsidian:    { head: 'Obsidian Helm',      body: 'Obsidian Carapace',   arms: 'Obsidian Guards',      legs: 'Obsidian Greaves' },
  ascendant:   { head: 'Ascendant Crest',    body: 'Ascendant Harness',   arms: 'Ascendant Bracers',    legs: 'Ascendant Striders' },
  dominion:    { head: 'Dominion Crown',     body: 'Dominion Rig',        arms: 'Dominion Gauntlets',   legs: 'Dominion Striders' },
  astralis:    { head: 'Astralis Crown',     body: 'Astralis Mantle',     arms: 'Astralis Gauntlets',   legs: 'Astralis Striders' },
  singularity: { head: 'Singularity Halo',   body: 'Singularity Frame',   arms: 'Singularity Drivers',  legs: 'Singularity Walkers' },
};

// Depot drop weights by rarity, matching the spec's descriptions.
const DROP_WEIGHT = {
  common: 50,      // "Common"
  uncommon: 25,    // "Uncommon"
  rare: 10,        // "Rare"
  legendary: 3,    // "Rarely seen"
  galactic: 0.3,   // "Hardly ever seen"
};

function buildCatalog() {
  const out = [];
  SETS.forEach((set) => {
    SLOTS.forEach((slot) => {
      const names = PIECE_NAMES[set.id] || {};
      out.push({
        id: `${set.prefix}${slot}`,          // matches the art filename stem
        name: names[slot] || `${set.name} ${slot}`,
        setId: set.id,
        setName: set.name,
        slot,
        rarity: set.rarity,
        alignment: set.alignment,
        buffType: SLOT_BUFF[slot],
        percent: RARITY_PERCENT[set.rarity],
        icon: `${set.prefix}${slot}.png`,
        requiresReboots: set.rarity === 'galactic' ? REQUIRED_REBOOTS_FOR_GALACTIC : 0,
        dropWeight: DROP_WEIGHT[set.rarity],
      });
    });
  });
  return out;
}

const COSMETIC_PIECES = buildCatalog();

function pieceById(id) {
  return COSMETIC_PIECES.find((p) => p.id === id) || null;
}

class CosmeticError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function ownedList(player) {
  return player.ownedCosmeticPieces || (player.ownedCosmeticPieces = []);
}

function equippedMap(player) {
  if (!player.equippedCosmetics) {
    player.equippedCosmetics = { head: null, body: null, arms: null, legs: null };
  }
  return player.equippedCosmetics;
}

function grant(playerId, pieceId) {
  const player = db.players.get(playerId);
  if (!player) throw new CosmeticError('NO_PLAYER', 'Player not found');
  if (!pieceById(pieceId)) throw new CosmeticError('NO_PIECE', 'Unknown cosmetic');
  const owned = ownedList(player);
  if (!owned.includes(pieceId)) owned.push(pieceId);
  return owned;
}

function equip(playerId, pieceId) {
  const player = db.players.get(playerId);
  if (!player) throw new CosmeticError('NO_PLAYER', 'Player not found');
  const piece = pieceById(pieceId);
  if (!piece) throw new CosmeticError('NO_PIECE', 'Unknown cosmetic');
  if (!ownedList(player).includes(pieceId)) {
    throw new CosmeticError('NOT_OWNED', `You don't own the ${piece.name}`);
  }
  // The Galactic gate. Owning is fine; wearing needs the re-boots.
  if (piece.requiresReboots && (player.rebootCount || 0) < piece.requiresReboots) {
    throw new CosmeticError(
      'REBOOTS_REQUIRED',
      `${piece.name} needs ${piece.requiresReboots} Re-Boots to equip — you have ${player.rebootCount || 0}`
    );
  }
  const equipped = equippedMap(player);
  const previous = equipped[piece.slot];
  equipped[piece.slot] = pieceId;
  return { equipped, slot: piece.slot, replaced: previous };
}

function unequip(playerId, slot) {
  const player = db.players.get(playerId);
  if (!player) throw new CosmeticError('NO_PLAYER', 'Player not found');
  if (!SLOTS.includes(slot)) throw new CosmeticError('BAD_SLOT', 'Unknown slot');
  const equipped = equippedMap(player);
  const removed = equipped[slot];
  equipped[slot] = null;
  return { equipped, slot, removed };
}

// Which sets the player is currently wearing all four pieces of.
function completeSets(player) {
  const equipped = equippedMap(player);
  const bySet = {};
  SLOTS.forEach((slot) => {
    const id = equipped[slot];
    if (!id) return;
    const piece = pieceById(id);
    if (!piece) return;
    bySet[piece.setId] = (bySet[piece.setId] || 0) + 1;
  });
  return Object.keys(bySet).filter((setId) => bySet[setId] === SLOTS.length);
}

// Additive buff set for the central engine. Consumed by buffs.js.
function playerBuffSet(player) {
  const set = { hp: 0, attack: 0 };
  const equipped = equippedMap(player);
  SLOTS.forEach((slot) => {
    const id = equipped[slot];
    if (!id) return;
    const piece = pieceById(id);
    if (!piece) return;
    // A Galactic piece somehow equipped below the re-boot threshold
    // contributes nothing — belt and braces, in case an old save
    // predates the gate.
    if (piece.requiresReboots && (player.rebootCount || 0) < piece.requiresReboots) return;
    set[piece.buffType] += piece.percent;
  });
  // Four-piece bonus, once per complete set.
  const complete = completeSets(player);
  if (complete.length) {
    set.hp += SET_BONUS_PERCENT * complete.length;
    set.attack += SET_BONUS_PERCENT * complete.length;
  }
  return set;
}

// Weighted random piece, for Depot drops.
function rollDepotCosmetic() {
  const total = COSMETIC_PIECES.reduce((a, p) => a + p.dropWeight, 0);
  let roll = Math.random() * total;
  for (const piece of COSMETIC_PIECES) {
    roll -= piece.dropWeight;
    if (roll <= 0) return piece;
  }
  return COSMETIC_PIECES[COSMETIC_PIECES.length - 1];
}

function summaryFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new CosmeticError('NO_PLAYER', 'Player not found');
  const owned = ownedList(player);
  const equipped = equippedMap(player);
  const complete = completeSets(player);
  const buffSet = playerBuffSet(player);

  return {
    slots: SLOTS,
    equipped,
    completeSets: complete,
    setBonusActive: complete.length > 0,
    setBonusPercent: SET_BONUS_PERCENT * 100,
    rebootCount: player.rebootCount || 0,
    galacticUnlocked: (player.rebootCount || 0) >= REQUIRED_REBOOTS_FOR_GALACTIC,
    requiredRebootsForGalactic: REQUIRED_REBOOTS_FOR_GALACTIC,
    totals: { hpPercent: Math.round(buffSet.hp * 1000) / 10, attackPercent: Math.round(buffSet.attack * 1000) / 10 },
    sets: SETS.map((set) => {
      const pieces = COSMETIC_PIECES.filter((p) => p.setId === set.id);
      return {
        ...set,
        percent: RARITY_PERCENT[set.rarity],
        ownedCount: pieces.filter((p) => owned.includes(p.id)).length,
        totalPieces: pieces.length,
        locked: set.rarity === 'galactic' && (player.rebootCount || 0) < REQUIRED_REBOOTS_FOR_GALACTIC,
        pieces: pieces.map((p) => ({
          ...p,
          owned: owned.includes(p.id),
          equipped: equipped[p.slot] === p.id,
        })),
      };
    }),
  };
}

module.exports = {
  COSMETIC_PIECES,
  SETS,
  SLOTS,
  SLOT_BUFF,
  RARITY_PERCENT,
  SET_BONUS_PERCENT,
  REQUIRED_REBOOTS_FOR_GALACTIC,
  DROP_WEIGHT,
  pieceById,
  grant,
  equip,
  unequip,
  completeSets,
  playerBuffSet,
  rollDepotCosmetic,
  summaryFor,
  CosmeticError,
};
