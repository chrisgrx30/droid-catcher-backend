# Sparkfield — Backend Prototype

A runnable prototype of the core game loop: **spawn → capture → own → farm crystals → capture again.**

Built with **zero external dependencies** (Node's built-in `http` module only), so it runs anywhere with just Node installed — no `npm install` needed. This is meant as a working reference for the game logic, not a production server as-is (see "Moving to production" below).

## Running it

```bash
node src/server.js
# -> Sparkfield backend running on http://localhost:3000
```

## Endpoints

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| POST | `/players` | `{ username }` | Create a player (seeds 3 workshop slots, 1 unlocked) |
| GET | `/players/:id` | — | Fetch player state |
| GET | `/spawns` | `?lat=&lng=&radius=` | Get nearby active spawns (lazily spawns into the queried cell) |
| POST | `/capture-attempt` | `{ playerId, spawnId, crystalsSpent, padAccuracy, attemptDurationMs, playerLat, playerLng }` | Server-authoritative capture resolution |
| GET | `/workshop/:playerId` | — | Settle + return accrued crystals, slots, owned droids |
| POST | `/workshop/assign` | `{ playerId, droidId, slotId }` | Assign a droid to a workshop slot (settles first) |
| POST | `/workshop/unassign` | `{ playerId, droidId }` | Remove a droid from its slot (settles first) |

## File map

- `src/db.js` — in-memory data store, seeded droid species (mirrors the Postgres schema)
- `src/geo.js` — cell bucketing (geohash-style) + Haversine distance for proximity checks
- `src/spawns.js` — spawn generation (weighted by rarity), active-cell tracking, TTL/cap enforcement
- `src/capture.js` — server-side capture resolver: validates proximity/crystals/input plausibility, computes success chance, commits the outcome
- `src/workshop.js` — compute-on-read crystal accrual (no scheduled tick job), offline cap, settle-before-reassign logic
- `src/server.js` — HTTP routing wiring the above together

## Moving to production

This prototype intentionally collapses several things that should be separate services at scale:

- **`db.js`'s in-memory Maps** → split into Postgres (`players`, `owned_droids`, `workshop_slots`, `capture_attempts`, `crystal_transactions`) and Redis (`spawns`, using native key TTL instead of the manual `purgeExpiredSpawns()` pass).
- **`geo.js`'s hand-rolled grid** → swap for a real geohash library (e.g. `ngeohash`) or PostGIS/Redis geospatial commands.
- **Spawn generation** → currently lazy (triggered by player queries); production should also run a scheduled background job per active cell so spawns exist before the first query, not just after.
- **Auth** → `playerId` is currently trusted from the request body. Production needs real session/token auth so players can't act as other players.
- **Rate limiting** → not implemented here; add per-player request throttling on `/spawns` and `/capture-attempt` as designed (anti-bot).
- **Anti-cheat** → the checks in `capture.js` (range, timing/accuracy plausibility) are a starting point, not exhaustive — expect to iterate on thresholds once you have real player data.
