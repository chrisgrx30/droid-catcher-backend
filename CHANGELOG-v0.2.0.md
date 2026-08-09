# Sparkfield — Technical Changelog, v0.1.9 → v0.2.0

Written for the developer. Behaviour-level release notes for players are
in `whats-new-v0.2.0.md`; tuning values are in `TUNING-GUIDE.md`.

**Baseline:** v0.1.9 as shipped.
**Files changed:** 6 code files, 3 docs, 1 new asset folder.
**Dependencies added:** none. Still zero-dependency, Node 18+.

---

## 1. Files touched

| File | Change |
|---|---|
| `src/db.js` | Apex tier + 30 species, Apex Hunt event, cube economy, 4 new player currencies, rarity-table gap fixes |
| `src/capture.js` | Capture radius moved to a single exported constant; Apex cube drops |
| `src/spawns.js` | `withinCaptureRadius` flag, `captureRadiusMeters` in response, Apex city cap |
| `src/workshop.js` | Apex levelling on cubes, cube drop on release, `nextLevelCurrency` in `enrichDroid` |
| `src/battle.js` | Apex encounter type (new), Apex constants, view/list branches widened |
| `src/server.js` | 5 new routes, `/assets/apex/` static route, 4 new fields in the workshop payload |
| `test-terminal.html` | Manual coordinate override, two-band radar UI, Apex theming/panels, art-slug fallback, changelog |
| `PANEL-BACKGROUNDS-INDEX.md` | New panels documented |
| `TUNING-GUIDE.md` | v0.2.0 section appended |
| `assets/apex/` | New folder + README |
| `package.json` | Version 0.1.9 → 0.2.0 |

---

## 2. Bugs fixed

### 2.1 `OUT_OF_RANGE` was never enforced (`test-terminal.html`)

`attemptCapture()` sent the spawn's own coordinates as the player position:

```js
playerLat: spawn.lat,
playerLng: spawn.lng,
```

The server computed distance from the droid to itself — always `0`, so
the range check in `capture.js` passed unconditionally. It has never
fired in production. Now sends `state.lastLat` / `state.lastLng`.

This mattered immediately: without it the new 15m radius would have been
cosmetic (client greys out the button, server accepts anyway).

### 2.2 `galactic` missing from four of five rarity tables (`src/db.js`)

`galactic` existed in `RARITY_BASE_STATS` only. It was absent from
`RARITY_TTL_MS`, `RARITY_MAX_PER_CELL`, `MIN_CRYSTAL_COST` and
`RARITY_LEVEL_COST_MULTIPLIER`.

`scaledMinCrystalCost('galactic', 0)` returned `NaN`. Never triggered in
play because Scaffitan Eternal is `isEvolutionOnly` with `spawnWeight: 0`,
but it was a live trap for any future galactic-tier spawn. All four
tables now have entries.

**Note for future work:** a rarity is defined across five separate
lookup tables. Adding a tier means editing all five.

### 2.3 Droid art slug dropped hyphenated filenames (`test-terminal.html`)

`baseSlug` stripped whitespace but kept hyphens, so `Corsair-X` resolved
to `corsair-x.png`. Five Apex species have hyphens in the name but not in
the filename (`Verdant-01`→`verdant01.png`, `Specter-7`, `Corsair-X`,
`Assembler-X`, `Tidal-X`).

A global strip would have broken existing species that *do* use
hyphenated files (`Recycl-8`, `Quasar-X`, `Aurora-X`, `Frostbyte-X`).
Fix is an ordered candidate list — hyphenated form tried first, then
de-hyphenated. Both conventions now work.

---

## 3. Radar sweep — two-band capture

### `src/capture.js`

```js
const CAPTURE_RADIUS_METERS = 15;
const MAX_PLAUSIBLE_RANGE_METERS = CAPTURE_RADIUS_METERS; // alias, existing refs unchanged
```

Exported. Was a bare `75`. `OUT_OF_RANGE` message rewritten to be
player-facing and to state the required distance.

### `src/spawns.js`

Imports `CAPTURE_RADIUS_METERS` from `capture.js` rather than
redeclaring, so map and server can't disagree.

- Each spawn result gains `withinCaptureRadius: dist <= CAPTURE_RADIUS_METERS`
  (compared against raw distance, not the rounded `distanceMeters`, so a
  droid at 15.4m doesn't display "15m" while refusing to open).
- Response gains `captureRadiusMeters`.

No circular dependency: `capture.js` requires `db`/`geo`/`workshop`, none
of which require `spawns`.

### `test-terminal.html`

- `state.captureRadiusMeters` mirrors the server value, defaults to 15.
- `drawCaptureRadiusRing()` — Leaflet `L.circle` redrawn each scan.
- Out-of-range spawn cards render `.out-of-range` (dimmed, greyscale
  icon) with no capture track, slider or LOCK-ON. Early `return` in the
  `forEach` skips the animation interval and event wiring entirely.
- Out-of-range map markers are hollow/dashed; popup shows distance.

---

## 4. Manual coordinate override (admin)

Client-only. No server changes.

- `state.coordOverride = { lat, lng, label }`, persisted to
  `localStorage` under `sparkfield.coordOverride`.
- `btnUseLocation` short-circuits `navigator.geolocation` when set.
- `applyCoordOverride()` validates lat ∈ [-90,90], lng ∈ [-180,180].
- Six presets in `COORD_PRESETS`, chosen to span the longitude-derived
  local-hour logic in `spawns.js` so time-gated collections (Football,
  Void Zombie, Lumen Sentinel) are reachable on demand.
- Red banner (`#coordOverrideBanner`) on the Capture tab whenever active.

**Security note:** this is a testing tool gated behind the admin PIN and
implemented entirely client-side. The eventual paid player-facing version
must validate position server-side, or it is trivially free.

---

## 5. Apex tier

### 5.1 Data (`src/db.js`)

New rarity `apex` added to all five tables:

| Table | Value |
|---|---|
| `RARITY_BASE_STATS` | `{ hp: 2200, attack: 140 }` |
| `RARITY_TTL_MS` | 3 min |
| `RARITY_MAX_PER_CELL` | 1 |
| `MIN_CRYSTAL_COST` | 25 (between rare 15 and legendary 40) |
| `RARITY_LEVEL_COST_MULTIPLIER` | 8 |

Plus `const APEX_CITY_CAP = 3`.

30 species appended to `droidSpecies`, all with:
`rarity: 'apex'`, `collection: 'apex'`, `spawnWeight: 0`,
`baseCaptureRate: 0.02`, `baseCrystalRate: 120`, `isApex: true`.
Alignments split light/dark so existing alignment-based buffs, tinting
and marker logic apply without special-casing.

`spawnWeight: 0` is the gate — Apex cannot spawn outside an event, by
construction rather than by a conditional.

### 5.2 Apex Hunt event

Reuses the existing grant-mode event machinery (same mechanism as
Solar/Summer). No new spawn code.

```js
APEX_HUNT_DURATION_MS  = 30 * 60 * 1000
APEX_HUNT_GRANT_WEIGHT = 0.35   // per species, x30 species
APEX_HUNT_COOLDOWN_MS  = 6 * 60 * 60 * 1000
createApexHuntEvent({ durationMs })
isApexHuntActive(now)
apexSpeciesList()
```

Weight drops back to 0 automatically at `endTime` — no cleanup pass.

`spawns.js` gains `countActiveApexCityWide()` and a cap check mirroring
the cosmic one.

### 5.3 Apex Cubes

```js
APEX_CUBE_MIN_DROP = 1
APEX_CUBE_MAX_DROP = 5
APEX_CUBE_LEVEL_MULTIPLIER = 1
apexCubeLevelUpCost(level)  // 10 * level^1.6 * multiplier
rollApexCubeDrop()
isApexSpecies(species)
```

Three drop routes, all guaranteed non-zero:

1. **Capture attempt** (`capture.js`) — awarded on **success *and*
   failure**. Rationale: at a 2% catch rate, success-only would let a
   player work a full 30-minute hunt for nothing. Flip by moving the
   block inside `if (success)`.
2. **Battle defeat** (`battle.js`) — per surviving participant.
3. **Release** (`workshop.js`).

`levelUpDroid()` branches on `db.isApexSpecies(species)` and spends
`player.apexCubes` instead of crystals. Returns `costCurrency` so the UI
knows which symbol to show. Crystal balance untouched on that path — no
`crystalTransactions` entry, since no crystals move.

`enrichDroid()` gains `nextLevelCurrency` and `isApex`.

### 5.4 Apex battles (`src/battle.js`)

Deliberately **separate functions**, not flags on the Titan path, so the
two can be tuned independently:

```
createApexChallenge(creatorId, invitedPlayerIds, creatorTeamIds)
joinApexBattle(battleId, playerId, teamDroidIds)
startApexBattle(battleId, creatorId)
attackApex(battleId, playerId)
```

Battle object carries `isApexBattle: true`, `apexSpeciesId`, `apexName`,
`cubeRewards`. Boss droid uses `isTitan: true` to reuse the existing
`enrichDroid` boss path, plus `isApexBoss: true` and a real `speciesId`
so the client can render the actual art.

Which of the 30 shows up is rolled at **start** time, not creation, so
the party doesn't know what they're facing while recruiting.

`getBattleView()` and `getBattlesForPlayer()` branches widened from
`isGroupTitanBattle` to `isGroupTitanBattle || isApexBattle`.

New player field: `apexCooldownUntil`.

#### Balance — read this before retuning

```js
APEX_BATTLE_HP     = 20000
APEX_BATTLE_ATTACK = 1100
APEX_ENTRY_FEE     = 2500
APEX_COOLDOWN_MS   = 3h
APEX_MAX_PARTICIPANTS = 6
```

**Turns rotate, so only one player attacks per turn regardless of party
size.** Extra players do *not* increase damage output — they add team HP,
which buys more turns before the raid wipes.

Consequence: **boss ATTACK is the lever that makes this group content,
not boss HP.** Raising HP alone lengthens the fight equally for all party
sizes and does nothing to discourage solo.

First pass was 18,000 HP / 260 attack and a solo player won in 34 turns.
Current values, measured against 4× level-20 Apex (8470 HP / 539 attack
each):

| Party | Team HP | Turns survived | Damage dealt | Result |
|---|---|---|---|---|
| 1 | 33,880 | ~30 | ~16,200 | **Loses** |
| 2 | 67,760 | ~61 | ~32,900 | Wins narrowly |
| 4 | 135,520 | ~123 | ~66,300 | Comfortable |
| 6 | 203,280 | ~184 | ~99,200 | Comfortable |

Verified by simulation: solo lost on turn 33; 2/4/6 won on turns 38/37/38.

---

## 6. New currencies

`apexCubes`, `titanTokens`, `guildTokens`, `joyCoins` — added to:

- `createPlayer()` defaults
- `importState()` `playerDefaults` (**required** — see §8)
- `TRADEABLE_MATERIALS`
- `SHOP_CATALOG` (tokens at 1,000,000 crystals each)
- `/workshop/:playerId` response payload

Tokens currently have **no spend route**. Titan/Guild token earn routes
(Titan battle drop, guild activity) are not implemented — shop is the
only source, same stopgap pattern as Pad RAM and Repair Kits.

---

## 7. New endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/events/apex-hunt` | `adminCode` | Launch a 30-min Apex Hunt |
| POST | `/battles/apex` | — | Create an Apex encounter |
| POST | `/battles/:id/apex-join` | — | Join one |
| POST | `/battles/:id/apex-start` | — | Creator starts the fight |
| POST | `/battles/:id/apex-attack` | — | Take a turn |
| GET | `/assets/apex/<file>` | — | Apex background art |

`/events/apex-hunt` builds the species list and grant weights server-side
so a client can't launch a hunt with the wrong odds.

Route ordering checked: `/battles/apex` does not shadow `/battles/titan`
(exact-match `pathname ===`, and the regex routes are anchored).

---

## 8. Persistence — important

`db.exportState()` snapshots a **fixed list** of collections. Anything
not on that list is memory-only and dies on every Render redeploy or
spin-down.

All five new player fields were added to `importState()`'s
`playerDefaults`. Verified by simulating a v0.1.9-era snapshot with those
keys deleted: all restore as `0`/`null`, not `undefined`. Without this
they'd come back undefined and render as `NaN` on first arithmetic.

**Any future player field must be added to `playerDefaults` or existing
testers lose it.**

---

## 9. Verification performed

- `node --check` on all 10 `src/*.js` and on the extracted client script
- Server boots clean; `/`, `/species`, `/shop`, `/materials`,
  `/cosmetics`, `/guilds`, `/events` all 200; `/events/apex-hunt` 201
  with valid code, 403 with invalid
- Apex spawn gating: 0 before a hunt, capped count during
- Capture: 60 attempts at max crystals + 0.95 accuracy → 2 catches (3%),
  195 cubes
- Levelling: 10 / 30 / 58 cubes for levels 2 / 3 / 4; crystal balance
  confirmed unchanged; insufficient-cubes path throws correctly
- Release: cube drop confirmed
- Battle: solo/2/4/6 party simulation (table in §5.4)
- Persistence: legacy-snapshot round-trip
- Out-of-range capture correctly rejected at 43m

---

## 10. Not implemented

- Joystick / Pulse system (tokens exist but are unspendable)
- Titan Token and Guild Token earn routes
- `assets/apex/apexhunt.png` slot is documented but not yet wired to a
  panel
- Server-side validation for a paid player-facing location override

---

## 11. Pre-existing issues noted, not changed

- `server.js` is a ~110-branch sequential `if` chain. Works, but every
  new route is O(n) to locate and easy to duplicate accidentally.
- `assets/materials/` exists on disk (`energytube.png`, `repairkit.png`)
  but **has no server route** — those files are unreachable over HTTP.
  Either add a route or move them into `assets/misc/`.
- `README.md` in the repo root is stale: it documents 7 endpoints and a
  `{ username }` create body from a much earlier version.
