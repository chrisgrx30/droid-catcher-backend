# Sparkfield — Self-Service Tuning Guide

Everything below lives in plain text files — no special software needed,
any text editor works (VS Code recommended if you want line numbers and
syntax highlighting, but Notepad works fine too). After any change:
save the file, restart the server (`node src/server.js`).

All numbers referenced here are the real, current values as of v0.1.5 —
pulled directly from the live code while writing this, not recalled from
memory.

---

## 1. Attack & HP — every droid at once

**File:** `src/db.js`
**Find:** `const RARITY_BASE_STATS = {`

```js
const RARITY_BASE_STATS = {
  common: { hp: 50, attack: 8 },
  uncommon: { hp: 90, attack: 14 },
  rare: { hp: 150, attack: 22 },
  legendary: { hp: 260, attack: 35 },
  cosmic: { hp: 200, attack: 20 },
  galactic: { hp: 400, attack: 50 },
};
```

Every droid of that rarity uses these numbers as its base (before level
scaling). Change a number here and it affects **every species at that
rarity** — this is the fastest way to rebalance broadly. A droid's
actual level-N stats are `base × level multiplier`, so changing this
table shifts the whole curve at once.

**To change ONE specific droid's stats instead of a whole rarity tier**,
find that species' own line (see Section 7 for how species lines look)
— most don't override `statsFor(rarity)`, so giving one droid unique
stats means replacing `...statsFor('common')` with explicit
`baseHP: 65, baseAttack: 10` on that one line.

---

## 2. Capture Chance (how hard it is to catch)

**File:** `src/db.js`
**Find:** the species' own line, e.g. Puffkin:
```js
{ id: id(), name: 'Puffkin', ..., baseCaptureRate: 0.70, ... }
```

`baseCaptureRate` is a 0–1 value (0.70 = 70% base chance before
crystal/pad-skill bonuses apply). Every species has its own value on
its own line — search for the species name to find it. Lower = harder
to catch, higher = easier.

---

## 3. Spawn Rate (how often it appears at all)

**Same line as capture chance**, different field:
```js
{ id: id(), name: 'Puffkin', ..., spawnWeight: 7.5, ... }
```

`spawnWeight` is relative to every other species' weight combined —
it's not a percentage. Raise it to spawn more often, lower it to spawn
less. Species with `spawnWeight: 0` never wild-spawn at all (used for
evolution-only tiers, companions, and Scaffitan).

---

## 4. Evolution Requirements

**File:** `src/db.js`
**Find:** `const EVOLUTION_TABLE = {`

```js
const EVOLUTION_TABLE = {
  [leafkinSpecies.id]: { evolvesTo: bushySpecies.id, novaChipCost: 15 },
  [shamblerSpecies.id]: { evolvesTo: walkerSpecies.id, novaChipCost: 15 },
  [walkerSpecies.id]: { evolvesTo: corruptorSpecies.id, novaChipCost: 25, extraCrystalCost: 1000 },
  [corruptorSpecies.id]: { evolvesTo: voidlordSpeciesId(), novaChipCost: 40, extraMaterial: 'lightStones', extraMaterialCost: 1 },
  ...
};
```

Each line is one evolution step. `novaChipCost` is always required.
`extraCrystalCost` and `extraMaterial`/`extraMaterialCost` are optional
— add them to any line to require crystals or a specific material
alongside Nova Chips (matching the `player[key]` field name, e.g.
`lightStones`, `darkCrystals`, `paint`).

---

## 5. Level-Up Cost

**File:** `src/db.js`
**Find:** `function levelUpCost(currentLevel, rarity = 'common') {`

```js
function levelUpCost(currentLevel, rarity = 'common') {
  const multiplier = RARITY_LEVEL_COST_MULTIPLIER[rarity] ?? 1;
  return Math.round(10 * Math.pow(currentLevel, 1.6) * multiplier);
}
```

The `10` is the base cost, `1.6` is the curve steepness (higher =
costs escalate faster per level), and `RARITY_LEVEL_COST_MULTIPLIER`
(a separate table just above this) scales the whole curve per rarity.
Level cap itself is `const DROID_LEVEL_CAP = 20;`, a few lines above.

---

## 6. Adding More Droids to the Zombie/Lumen Encounter Chains

**Current full chains, for reference** (both lines cost-mirror each other,
just with different material names):

| Tier | Zombie Line | Lumen Line | Nova Chips | Crystals | Other materials |
|---|---|---|---|---|---|
| Common → Uncommon | Shambler → Walker | Illume → Lumenguard | 15 | — | — |
| Uncommon → Rare | Walker → Corruptor | Lumenguard → Luminor | 25 | 1,000 | 5 Zombie Juice / Lume Cells |
| Rare → Legendary | Corruptor → Voidlord | Luminor → Luxion | 40 | — | 1 Light Stone / Dark Crystal + 15 Zombie Juice / Lume Cells |
| Legendary → Cosmic | Voidlord → Voidsovereign | Luxion → Luminarch | 60 | 2,000 | 25 Zombie Juice / Lume Cells |

The Light Stone/Dark Crystal requirement at Rare→Legendary is the
original cross-alignment design (Dark line needs a Light material, and
vice versa) — still intact, just sitting alongside the new material
rather than replaced by it.

**File:** `src/db.js`

These are 4-tier chains (Common → Uncommon → Rare → Legendary), only
Common is wild-spawnable, and the rest are evolution-only. To extend a
chain or add a whole new one:

1. **Add the species lines** — copy an existing tier's line as a
   template, e.g. Shambler's:
   ```js
   { id: id(), name: 'Shambler', alignment: 'dark', rarity: 'common', collection: 'void_zombie', baseCaptureRate: 0.70, baseCrystalRate: 1, spawnWeight: 0, dailyWeight: DAILY_LINE_TIER_WEIGHT.common, ...statsFor('common') },
   ```
   Change `name`, `rarity` (uncommon/rare/legendary for later tiers),
   and `collection` (use a new one for a whole new chain, e.g.
   `'my_new_chain'`). Later tiers need `spawnWeight: 0`, no
   `dailyWeight`, and `isEvolutionOnly: true` (this is what makes the
   Dex correctly show "evolution-only" instead of a capture rate).
   Real example (Walker, tier 2 of the Zombie line):
   ```js
   { id: id(), name: 'Walker', alignment: 'dark', rarity: 'uncommon', collection: 'void_zombie', baseCaptureRate: 0.45, baseCrystalRate: 3, spawnWeight: 0, isEvolutionOnly: true, ...statsFor('uncommon') },
   ```

2. **Add the lookup + evolution table entries** near the existing
   `shamblerSpecies`/`illumeSpecies` lines:
   ```js
   const myNewSpecies = droidSpecies.find((s) => s.name === 'My New Droid');
   ```
   Then add to `EVOLUTION_TABLE`, same pattern as Section 4.

---

## 7. Adding a Brand New Droid (spawn pool + Dex)

**File:** `src/db.js` — species are just entries in the `droidSpecies`
array. The Dex is generated automatically from this array — there's
no separate "Dex list" to update.

Copy an existing line as a template:
```js
{ id: id(), name: 'Puffkin', alignment: 'light', rarity: 'common', collection: 'mythical', baseCaptureRate: 0.70, baseCrystalRate: 1, spawnWeight: 7.5, isStarterOption: true, ...statsFor('common') },
```

Fields that matter:
- `name` — display name, and also the image filename (lowercased, no
  spaces) — see `IMAGE-INDEX.md` for the full image system
- `alignment` — `'light'`, `'dark'`, or `'cosmic'`
- `rarity` — `common`/`uncommon`/`rare`/`legendary`/`cosmic`/`galactic`
- `collection` — groups it for Dex sections and event decks
- `spawnWeight` — see Section 3
- `isStarterOption: true` — only add this if it should be pickable as
  a starter (currently exactly 4 droids have this)

As soon as it's in the array with `spawnWeight > 0`, it'll start
spawning and appear in the Dex automatically.

---

## 8. Creating a New Event Dex

An "event dex" is a `collection` value tagged with `eventOnly: true`
on each species — the frontend already has generic support for this,
you only need to add the species correctly (Section 7) and label it.

**Critical**: add `eventOnly: true` to every species in the new event
collection, or they'll wrongly show up in the *main* Dex instead of
their own Event Dex. Real example (Solar/Summer):
```js
{ id: id(), name: 'Sunbud', ..., collection: 'solar', spawnWeight: 0, eventOnly: true, ...statsFor('common') },
```

**File:** `test-terminal.html`
**Find:** `const EVENT_DECK_LABELS = { solar: '☀ Summer Dex' };`

Add your new collection:
```js
const EVENT_DECK_LABELS = { solar: '☀ Summer Dex', myevent: '🎃 Halloween Dex' };
```

That's the only frontend change needed — the Event Dex tab
automatically shows a button per label here, and clicking it filters
to droids of that collection.

---

## 9. Creating a Limited-Time Event Button (like Summer Event)

**File:** `test-terminal.html`
**Find:** `$('btnEventSummer').onclick = async () => {` (this is the
full working example to copy)

The pattern: a button that calls `POST /events` with `mode: 'grant'`,
a list of species IDs to boost, and a start/end time. Copy the whole
handler, change:
- `'Summer Event'` → your event's name
- `solarSpeciesIds` → filter by your new collection instead of
  `'solar'`
- the `7 * 24 * 60 * 60 * 1000` (7 days) → however long you want it
  to run

Add a matching button in the HTML near the existing
`btnEventSummer` button, in the admin panel section.

---

## Quick reference — every file mentioned above

| What you're changing | File |
|---|---|
| Attack/HP by rarity | `src/db.js` → `RARITY_BASE_STATS` |
| Capture chance (per species) | `src/db.js` → that species' line, `baseCaptureRate` |
| Spawn rate (per species) | `src/db.js` → that species' line, `spawnWeight` |
| Evolution costs | `src/db.js` → `EVOLUTION_TABLE` |
| Level-up cost curve | `src/db.js` → `levelUpCost()` |
| New droids / Dex entries | `src/db.js` → `droidSpecies` array |
| Event Dex labels | `test-terminal.html` → `EVENT_DECK_LABELS` |
| Limited-time event buttons | `test-terminal.html` → copy `btnEventSummer` handler |
| Titan HP/Attack | `src/battle.js` → `TITAN_ROSTER` |
| Capture minigame sweet-spot width | `test-terminal.html` → `RARITY_ZONE_WIDTH` |
