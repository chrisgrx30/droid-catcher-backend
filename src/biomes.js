// biomes.js
//
// REGIONAL BIOMES — the world stops being uniform.
//
// THE PROBLEM THIS SOLVES
// Every geo cell currently plays identically: the same weighted roll
// everywhere on Earth. Location is only ever "am I standing near a
// droid", never "is this place worth walking to". Biomes make WHERE you
// are matter.
//
// HOW A BIOME IS DECIDED — no map data needed
// We have no terrain API and adding one would break the zero-dependency
// rule, so the biome is DERIVED from the cell key itself: a stable hash
// of the coordinates picks a biome, weighted so common terrain is
// common. The same cell always resolves to the same biome, for every
// player, forever — which is the only property that actually matters.
// It behaves like terrain even though it isn't reading terrain.
//
// If real map data is ever added, only resolveBiome() changes; every
// caller keeps working.
//
// WHAT A BIOME DOES
// It multiplies the spawn weight of a few collections up and others
// down. Deliberately gentle: a biome should make a place feel
// characterful and worth a detour, not lock content behind a postcode.
// Nothing is ever reduced to zero — every droid remains catchable
// everywhere, just rarer or commoner.

const BIOMES = {
  verdant: {
    id: 'verdant',
    name: 'Verdant Zone',
    icon: '🌳',
    colour: '#4caf50',
    blurb: 'Parkland and growth. Nature droids thrive here.',
    weight: 26,
    favours: { nature: 2.2, mythical: 1.3 },
    suppresses: { void_zombie: 0.5 },
  },
  urban: {
    id: 'urban',
    name: 'Urban Sprawl',
    icon: '🏙️',
    colour: '#8b6de0',
    blurb: 'Dense signal noise. Void Zombies gather in the interference.',
    weight: 26,
    favours: { void_zombie: 2.2, wildcard: 1.2 },
    suppresses: { nature: 0.6 },
  },
  coastal: {
    id: 'coastal',
    name: 'Coastal Shelf',
    icon: '🌊',
    colour: '#4cb8e8',
    blurb: 'Open water and clear skies. Lumen Sentinels favour the light here.',
    weight: 18,
    favours: { lumen_sentinel: 2.2, cosmic: 1.4 },
    suppresses: { void_zombie: 0.7 },
  },
  industrial: {
    id: 'industrial',
    name: 'Industrial Belt',
    icon: '🏭',
    colour: '#e8862f',
    blurb: 'Scrap, heat and machinery. WildDroids scavenge the yards.',
    weight: 18,
    favours: { wildcard: 1.8, football: 1.5 },
    suppresses: { mythical: 0.7 },
  },
  highland: {
    id: 'highland',
    name: 'Highland Reach',
    icon: '⛰️',
    colour: '#b9c4cc',
    blurb: 'Thin air and long sightlines. Rare signals carry further.',
    weight: 9,
    favours: { mythical: 1.8, cosmic: 1.6, titan: 1.5 },
    suppresses: { wildcard: 0.8 },
  },
  anomaly: {
    id: 'anomaly',
    name: 'Anomaly Field',
    icon: '🌀',
    colour: '#ff2d3f',
    blurb: 'Something is wrong with the readings here. Everything rare is likelier.',
    weight: 3, // scarce on purpose — this is the cell people travel to
    favours: { cosmic: 2.5, titan: 2.0, mythical: 1.5, apex: 1.5 },
    suppresses: {},
    rarityBoost: 1.35, // rare-and-above get an extra nudge
  },
};

const BIOME_LIST = Object.values(BIOMES);
const TOTAL_WEIGHT = BIOME_LIST.reduce((a, b) => a + b.weight, 0);

// Deterministic 32-bit hash of the cell key. Same cell -> same biome,
// on every server, forever. No storage needed.
function hashCell(cellKey) {
  let h = 2166136261;
  const s = String(cellKey);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function resolveBiome(cellKey) {
  if (!cellKey) return BIOMES.urban;
  // Map the hash into the weighted table.
  const roll = (hashCell(cellKey) % 1000) / 1000 * TOTAL_WEIGHT;
  let acc = 0;
  for (const b of BIOME_LIST) {
    acc += b.weight;
    if (roll < acc) return b;
  }
  return BIOME_LIST[0];
}

// Multiplier applied to a species' spawn weight in this cell.
function speciesMultiplier(biome, species) {
  if (!biome || !species) return 1;
  let m = 1;
  const c = species.collection;
  if (biome.favours && biome.favours[c]) m *= biome.favours[c];
  if (biome.suppresses && biome.suppresses[c]) m *= biome.suppresses[c];
  if (biome.rarityBoost && ['rare', 'legendary', 'cosmic', 'galactic'].includes(species.rarity)) {
    m *= biome.rarityBoost;
  }
  return m;
}

// Player-facing summary for the scan panel.
function describe(cellKey) {
  const b = resolveBiome(cellKey);
  const up = Object.keys(b.favours || {});
  return {
    id: b.id,
    name: b.name,
    icon: b.icon,
    colour: b.colour,
    blurb: b.blurb,
    favours: up,
    suppresses: Object.keys(b.suppresses || {}),
  };
}

module.exports = { BIOMES, BIOME_LIST, resolveBiome, speciesMultiplier, describe, hashCell };
