# Droid Catcher — Backend Prototype

A runnable prototype of the core game loop: **spawn → capture → own → farm crystals → capture again.**

Built with **zero external dependencies** (Node's built-in `http` module only), so it runs anywhere with just Node installed — no `npm install` needed. This is meant as a working reference for the game logic, not a production server as-is (see "Moving to production" below).

## Running it

```bash
node src/server.js
# -> Droid Catcher backend running on http://localhost:3000
```

## Deploying live for beta testers

This can go live as a real website today — no app store, no graphics needed yet. The server now serves the test terminal itself at `/`, so testers just visit one URL.

**Recommended: Render (free, no credit card) + Upstash Redis (free, no credit card) for persistence.**

I checked current hosting options as of mid-2026: Railway dropped its ongoing free tier (one-time trial credit only now), Fly.io now requires a credit card with no free tier for new signups, but Render still offers a genuinely free web service deployed straight from GitHub. Pairing it with Upstash (a Redis database reachable over plain HTTPS) solves Render free tier's one real gotcha: **its filesystem is ephemeral** — anything written to local disk is wiped when the service spins down after 15 minutes of inactivity or redeploys. Upstash's data lives outside the app entirely, so tester progress survives that.

### Step 1 — Create the Upstash database (2 minutes)
1. Go to upstash.com → sign up (no card needed) → Create Database → Redis, any region close to you.
2. On the database's detail page, copy the **REST URL** and **REST TOKEN** shown under "REST API" — you'll paste these into Render in Step 3.

### Step 2 — Push this project to GitHub
1. Create a new GitHub repo, push the contents of this folder to it (the whole `droid-catcher-backend` folder, including `package.json`).

### Step 3 — Deploy on Render
1. Go to render.com → sign up (no card needed) → New → Web Service → connect your GitHub repo.
2. Settings: **Build Command** blank (nothing to build), **Start Command** `node src/server.js` (Render should auto-detect this from `package.json`, but set it explicitly if not).
3. Under **Environment**, add two variables: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — paste the values from Step 1.
4. Click **Create Web Service**. Render builds and deploys — you'll get a URL like `https://droid-catcher-backend.onrender.com`.
5. Visit that URL — the test terminal loads directly, already pointed at the right server (no config needed).

### What to tell testers
- Send them the Render URL — that's it, no downloads, no setup.
- **First load after idle may take 30-50 seconds** — Render's free tier "sleeps" the service after 15 minutes of no traffic and wakes it on the next request. This is normal, not a bug; just a one-time wait per session.
- Their progress (crystals, droids, levels) now survives that sleep/wake cycle via Upstash, and survives redeploys too if you push code updates during the beta.

### Skipping persistence
If you'd rather skip the Upstash setup for a very short test, just do Steps 2–3 without the environment variables — the server logs "Persistence disabled" and runs in-memory only, same as local dev. Testers will lose progress whenever the service spins down, but it's one less thing to set up.

## Design features implemented

- **Light/Dark alignment** — 16 droid species across 2 collections (Mythical + Nature/Corrupted Nature, see `concept-sheet-v1.md`), evenly split light/dark within each rarity tier.
- **Day/night spawn bias** — Light droids spawn ~1.75x more during daytime, Dark droids ~1.75x more at night, estimated from each spawn's longitude (not the server's local clock, since players are global). Tune via `ALIGNMENT_BIAS` in `spawns.js`.
- **Variants (shiny-equivalent)** — any droid, regardless of species/rarity, can roll `platinum` (+50% crystal production) or `rusty` (cosmetic-only collectible). Visible on the spawn card before capture, same as Pokémon Go's shiny sparkle. Real launch odds are ~1-in-1000 each (`VARIANT_ODDS_PRODUCTION` in `db.js`) — **currently running at 10% each for testing** (20% combined, so most spawns are still standard but variants show up often enough to test) via the `TESTING_HIGH_VARIANT_ODDS` flag near the top of `db.js`. **Set that flag to `false` before launch.**
- **Crystal power requirement** — the control pad needs a minimum number of crystals to even attempt a capture (`MIN_CRYSTAL_COST` in `db.js`, scales with rarity: common 1 / uncommon 5 / rare 15 / legendary 40). Attempts below the minimum are rejected outright, not just low-odds.
- **Starter droid** — since a new player has 0 crystals and can't yet meet the crystal-power minimum, every player gets one free common-tier droid at signup (`POST /players/:id/starter`), auto-assigned to their first workshop slot so farming starts immediately.
- **Per-droid crystal rate visibility** — every owned droid reports its own `crystalsPerMinute` (species base rate × level × slot multiplier × variant multiplier), and the workshop endpoint also returns an aggregate `crystalsPerSecond` for live-ticking UI. **Rate basis is per-minute rather than per-hour** for faster testing/leveling loops — same species base numbers, just a faster clock. Slow this back down before launch by changing the `elapsedMinutes` calc in `workshop.js` back to hours.
- **Buyable workshop slots** — players start with 1 unlocked slot (of 10 seeded); each additional slot costs 50 more crystals than the last (slot 1 = 50, slot 2 = 100, ... slot 9 = 450 — `slotUnlockCost()` in `db.js`).
- **Droid leveling** — spend crystals to level up an individual droid (up to level 20), increasing its crystal production (`POST /droids/:id/level-up`). Cost curve scales up per level via `levelUpCost()` in `db.js`.
- **Pad upgrades** — a separate, account-wide progression track (not per-droid): spend crystals to raise `player.padLevel` (`POST /players/:id/upgrade-pad`), which increases both a critical-capture chance (a guaranteed-success roll, starts at 2%, capped at 50%) and the ceiling on the accuracy-skill multiplier. Verified: at high pad level, critical rolls guarantee capture even against a Legendary's 5% base rate.
- **Time-exclusive events** — `POST /events` creates a time-boxed spawn-weight boost targeting either explicit species IDs or a whole `collection` (`mythical`/`nature`). Generalizes the same multiplier pattern the day/night bias already uses. Verified: a 5x Nature-collection event skewed spawns from the normal ~50/50 split to roughly 82/17 in favor of Nature.
- **Trading** — offer/accept/decline flow (`POST /trades`, `POST /trades/:id/accept`, `POST /trades/:id/decline`) rather than an instant swap, with two anti-abuse guardrails built in from the start: a 10-minute cooldown before a freshly-captured or freshly-traded droid can be traded again (closes the "launder rarity through fake trades on throwaway accounts" exploit), and a small rarity-scaled crystal fee paid by whoever *receives* each droid (`TRADE_FEE_BY_RARITY` in `db.js`) so trading stays a convenience rather than a strictly-better alternative to capturing.

## Visual test terminal

Open `test-terminal.html` directly in a browser (double-click it, or drag it into a tab) while the server is running. Deploy a pilot, pick a starter droid, scan for spawns, click a targeting reticle to attempt a capture, watch your crystal balance tick up live, unlock extra workshop slots, level up individual droids, upgrade your pad for critical captures, launch a test time-exclusive event, and trade droids with another player ID — all from the UI now, with live JSON logged at the bottom.

**Trading tip for solo testing:** open the terminal in two browser tabs (or two browser profiles) and deploy a separate pilot in each — then use the second pilot's player ID as the trade target in the first tab.

## Endpoints

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| GET | `/species` | — | Full droid species catalog, incl. min crystal cost per rarity |
| POST | `/players` | `{ username }` | Create a player (seeds 10 workshop slots, 1 unlocked) |
| GET | `/players/:id` | — | Fetch player state |
| POST | `/players/:id/starter` | `{ speciesId }` | One-time free starter droid (common tier only), auto-farms immediately |
| POST | `/players/:id/upgrade-pad` | — | Spend crystals to raise pad level (crit chance + skill ceiling) |
| GET | `/spawns` | `?lat=&lng=&radius=` | Get nearby active spawns (lazily spawns into the queried cell) |
| POST | `/capture-attempt` | `{ playerId, spawnId, crystalsSpent, padAccuracy, attemptDurationMs, playerLat, playerLng }` | Server-authoritative capture resolution (rejects below min crystal cost; can roll a critical capture) |
| GET | `/workshop/:playerId` | — | Settle + return accrued crystals, slots (with unlock costs), owned droids (with rates), pad level/crit chance |
| POST | `/workshop/assign` | `{ playerId, droidId, slotId }` | Assign a droid to a workshop slot (settles first) |
| POST | `/workshop/unassign` | `{ playerId, droidId }` | Remove a droid from its slot (settles first) |
| POST | `/workshop/unlock-slot` | `{ playerId, slotId }` | Buy an extra farming slot with crystals |
| POST | `/droids/:id/level-up` | `{ playerId }` | Spend crystals to level up a specific droid |
| GET | `/events` | — | List currently active time-exclusive events |
| POST | `/events` | `{ name, speciesIds? or collection?, spawnWeightMultiplier, startTime, endTime }` | Create a time-exclusive spawn event (dev/admin — no auth gate yet) |
| POST | `/trades` | `{ fromPlayerId, toPlayerId, offeredDroidIds?, offeredCrystals?, requestedDroidIds?, requestedCrystals? }` | Propose a trade |
| GET | `/trades/:playerId` | — | List all trades (any status) involving this player |
| POST | `/trades/:id/accept` | `{ playerId }` | Accept a pending trade (must be the recipient) |
| POST | `/trades/:id/decline` | `{ playerId }` | Decline a pending trade (either participant) |

## File map

- `src/db.js` — in-memory data store, seeded droid species (mirrors the Postgres schema), plus all constants/cost curves for leveling, pad upgrades, variants, events, and trading
- `src/geo.js` — cell bucketing (geohash-style) + Haversine distance for proximity checks
- `src/spawns.js` — spawn generation (weighted by rarity, day/night alignment bias, active event multipliers), active-cell tracking, TTL/cap enforcement
- `src/capture.js` — server-side capture resolver: validates proximity/crystals/input plausibility, computes success chance (incl. pad-level critical capture), commits the outcome
- `src/workshop.js` — compute-on-read crystal accrual, offline cap, settle-before-reassign logic, droid leveling, pad upgrades, slot unlocking
- `src/trades.js` — player-to-player trade offer/accept/decline flow with cooldown + fee guardrails
- `src/persistence.js` — optional durable save/load via Upstash Redis's REST API (no-ops entirely if unconfigured)
- `src/server.js` — HTTP routing wiring all of the above together, plus serves `test-terminal.html` at `/`

## Moving to production

This prototype intentionally collapses several things that should be separate services at scale:

- **`db.js`'s in-memory Maps** → split into Postgres (`players`, `owned_droids`, `workshop_slots`, `capture_attempts`, `crystal_transactions`) and Redis (`spawns`, using native key TTL instead of the manual `purgeExpiredSpawns()` pass).
- **`geo.js`'s hand-rolled grid** → swap for a real geohash library (e.g. `ngeohash`) or PostGIS/Redis geospatial commands.
- **Spawn generation** → currently lazy (triggered by player queries); production should also run a scheduled background job per active cell so spawns exist before the first query, not just after.
- **Auth** → `playerId` is currently trusted from the request body. Production needs real session/token auth so players can't act as other players.
- **Rate limiting** → not implemented here; add per-player request throttling on `/spawns` and `/capture-attempt` as designed (anti-bot).
- **Anti-cheat** → the checks in `capture.js` (range, timing/accuracy plausibility) are a starting point, not exhaustive — expect to iterate on thresholds once you have real player data.
