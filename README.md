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
- **Variants (shiny-equivalent)** — any droid, regardless of species/rarity, can roll `platinum` (500% crystal production) or `rusty` (200% crystal production — originally cosmetic-only, given a real bonus after playtest feedback that the hunt wasn't worth it at 0%). Visible on the spawn card before capture, same as Pokémon Go's shiny sparkle. Real launch odds are ~1-in-1000 each (`VARIANT_ODDS_PRODUCTION` in `db.js`) — **currently running at 10% each for testing** via the `TESTING_HIGH_VARIANT_ODDS` flag near the top of `db.js`. **Set that flag to `false` before launch.**
- **Crystal power requirement** — the control pad needs a minimum number of crystals to even attempt a capture (`MIN_CRYSTAL_COST` in `db.js`, scales with rarity: common 1 / uncommon 5 / rare 15 / legendary 40). Attempts below the minimum are rejected outright, not just low-odds.
- **Starter droid** — since a new player has 0 crystals and can't yet meet the crystal-power minimum, every player gets one free common-tier droid at signup (`POST /players/:id/starter`), auto-assigned to their first workshop slot so farming starts immediately.
- **Per-droid crystal rate visibility** — every owned droid reports its own `crystalsPerMinute` (species base rate × level × slot multiplier × variant multiplier), and the workshop endpoint also returns an aggregate `crystalsPerSecond` for live-ticking UI. **Rate basis is per-minute rather than per-hour** for faster testing/leveling loops — same species base numbers, just a faster clock. Slow this back down before launch by changing the `elapsedMinutes` calc in `workshop.js` back to hours.
- **Buyable workshop slots** — players start with 1 unlocked slot (of 10 seeded); each additional slot costs 50 more crystals than the last (slot 1 = 50, slot 2 = 100, ... slot 9 = 450 — `slotUnlockCost()` in `db.js`).
- **Droid leveling** — spend crystals to level up an individual droid (up to level 20), increasing its crystal production (`POST /droids/:id/level-up`). Cost curve scales up per level via `levelUpCost()` in `db.js`.
- **Pad upgrades** — a separate, account-wide progression track (not per-droid): spend crystals to raise `player.padLevel` (`POST /players/:id/upgrade-pad`), which increases both a critical-capture chance (a guaranteed-success roll, starts at 2%, capped at 50%) and the ceiling on the accuracy-skill multiplier. Verified: at high pad level, critical rolls guarantee capture even against a Legendary's 5% base rate.
- **Time-exclusive events** — `POST /events` creates a time-boxed spawn-weight boost targeting either explicit species IDs or a whole `collection` (`mythical`/`nature`). Generalizes the same multiplier pattern the day/night bias already uses. Verified: a 5x Nature-collection event skewed spawns from the normal ~50/50 split to roughly 82/17 in favor of Nature.
- **Trading** — offer/accept/decline flow (`POST /trades`, `POST /trades/:id/accept`, `POST /trades/:id/decline`) rather than an instant swap, with two anti-abuse guardrails built in from the start: a 10-minute cooldown before a freshly-captured or freshly-traded droid can be traded again (closes the "launder rarity through fake trades on throwaway accounts" exploit), and a small rarity-scaled crystal fee paid by whoever *receives* each droid (`TRADE_FEE_BY_RARITY` in `db.js`) so trading stays a convenience rather than a strictly-better alternative to capturing.

## Beta feedback round 7 (admin-lock events + redeem codes)

- **Two endpoints that were open to anyone who found the URL are now admin-gated**: `POST /events` (spawn manipulation) requires `adminCode: "xxxxxx"`, `POST /redeem-codes` (creating promo codes) requires `adminCode: "xxxxxx"` — deliberately different codes, so one leaking doesn't expose both. Verified live: both correctly reject with no code or the wrong code, and confirmed the two codes are genuinely separate (xxxxxx does *not* unlock redeem-codes, and vice versa).
- The event buttons stay visible in the UI (Boost Nature/Mythical, Start Summer Event) rather than being hidden, with a "🔒 Chris Admin Only — no access" caption above them. Clicking one prompts for the code; entering it wrong surfaces the same rejection message in the console log.
- This is still a shared-secret code, not real authentication — fine for a closed friends beta where the risk is "a curious tester pokes at the API," not fine if this ever opens up more widely.

## Beta feedback round 6 (Wildcard collection — 16 new droids)

- **Testers were completing the Dex too quickly**, so added a third full collection, **Wildcard**: Teacupper, Pangolynk, Toastybob, Redwolfe, Brollybot, Snowleopardon, Packmate, Oricalypse (Light) and Binx, Shadowtad, Tiktoker, Indrashark, Snapshot, Ghostcrane, Gamebot, Vaantheris (Dark) — 2 per rarity tier per alignment, same as Mythical/Nature.
- **Spawn weights rebalanced, not just added on top** — every existing species' weight was reduced so the *total* probability mass per rarity tier is exactly unchanged (common 60 / uncommon 25 / rare 12 / legendary 3, verified identical before and after). This means overall catch cadence by rarity feels the same as before, but each specific species is individually rarer — directly addresses "completing too fast" by both adding more targets and diluting per-species odds.
- Main Dex now covers 35 species (up from 19); Event Dex (Solar collection) unaffected at 8.

## Beta feedback round 5 (Farm/Storage rework, wishlist, Summer event)

- **Farming droids moved to the Farm tab** — a farming droid no longer appears in Storage at all; it shows inline in its Workshop slot card (tap to expand Level Up / Unassign). Storage now only shows droids *not* currently farming, with an "Assign to slot..." dropdown to move one into a slot. This also resolves the earlier "unassign doesn't re-sort" report — there's no longer a farming/not-farming split to get stale, since a droid simply moves between tabs.
- **Companion got its own tab** — previously buried under the Farm panel, easy to miss. New Companion tab shows the equipped companion, its buff (crystal-boost or capture-rate, worded correctly per companion type), and a list of every owned companion with one-tap equip/swap.
- **Click a Storage droid for full stats** — a popup shows HP, Attack, level, crystals/min, and next-level cost, without needing to scan a cramped row.
- **Bulk release** — select multiple droids in Storage (checkboxes + Select All) and release them all in one action, with a single result popup summing total crystals refunded and Nova Chips gained across the batch, rather than one popup per droid. New `POST /droids/release-bulk` endpoint settles earnings once for the whole batch, not once per droid.
- **Variant-aware "already caught" radar icon** — the 🎮 pad icon on spawn cards now checks the *specific* variant shown (a Rusty spawn only shows caught if you've caught a Rusty of that species before), not just "have I ever caught any version of this species."
- **Public wishlist** — post a "looking for" (a specific droid + optional variant, or Paint + optional color) visible to every player. Anyone can offer a trade against an open wish; accepting that trade automatically removes the wish from the board (linked via a new optional `wishId` on trade offers — no separate fulfillment step to forget). Verified the full loop directly: posted a wish, created a linked gift-trade (droid offered, nothing requested back), accepted it, confirmed ownership transferred and the wish vanished from the active list.
  - Also fixed a real gap this surfaced: the trade builder previously *required* selecting a droid on both sides, which made a pure gift (fulfilling a wish for free, or for crystals only) impossible. Requesting a droid back is now optional, and a crystal-ask field was added alongside it.
  - Known limitation: Paint wishes show on the board but aren't auto-fulfillable via trade yet (Paint isn't a trade-transferable item in this build) — noted directly in the UI rather than silently doing nothing.
- **Summer Event + Solar collection** — 8 new event-exclusive droids (Sunbud/Solara/Sundrift/Solaris Rex on Light, Scorchling/Heatfang/Dustwraith/Infernotitan on Dark), all `spawnWeight: 0` outside the event. This required a real addition, not just data: the existing event system only *multiplies* a species' spawn weight, which can't make a zero-weight species spawn at all (0 × anything is still 0). Added a second event mode — `grant` — that adds a real temporary weight instead of multiplying one. Verified directly: confirmed the old boost-mode approach truly does nothing for a zero-weight species, then confirmed the new grant-mode event produces real Solar-collection spawns at roughly the expected rate (88/291 ≈ 30% against a ~33% theoretical share).
- **Event Dex** — the 8 Solar species live in a separate Dex section so they don't sit as permanent "???" entries in the main Dex outside the event window; catching one is permanent once achieved, but doesn't count toward main Dex completion %.

## Beta feedback round 4 (tabbed layout + polish)

- **Tabbed navigation** — the terminal is no longer one long scrolling page. 8 tabs: Player, Capture, Farm, Storage, Guilds, Inventory, Events & Trading, Dex. Companion moved onto the Farm tab (it buffs farming), Cosmetics stayed on Player, Redeem Code moved to Inventory. Verified zero broken element references and zero duplicate IDs after the reorg (checked programmatically, not just visually).
- **New companion: Nebulfox** — second companion option alongside StarSprite, same cosmic rarity/spawn odds, but a different buff type entirely: +100% capture success chance instead of a crystal boost — useful for landing tough Legendary captures. The companion buff system was generalized to support both types (`companionBuffType: 'crystal' | 'capture_rate'`) rather than hardcoding StarSprite's effect. Verified live: 500 captures against a Legendary with Nebulfox equipped landed almost exactly on the hand-calculated expected success rate.
- **Guild member list** — `GET /guilds/:id` now returns actual usernames (with a crown marker for the creator), not just member IDs. Shown in the Guilds tab.
- **Dex: evolutions placed next to their origin** — Bushy now appears immediately after Leafkin in the Dex, not wherever it happens to sit in the species catalog.
- **Dex: Funky color accuracy** — the Funky dot's color now reflects which primary color (red/yellow/blue) was actually chosen when evolving, tracked per species.
- **Radar "already caught" indicator** — a small 🎮 icon appears next to any spawn whose species you've already caught, for players chasing full Dex completion.
- **Capture result popup** — a proper modal now appears after every capture attempt (success/fail, critical flag, paint drop, and — on failure — an explicit reminder of the crystals lost), instead of only logging to the console.
- **Custom cosmetic images** — cosmetics can now have real artwork too, via `assets/cosmetics/<cosmetic-id>.png` (same pattern as droid art, same graceful fallback to text if no image exists yet). New `GET /assets/cosmetics/<filename>` route, same path-traversal protection as the droid-art route.
- **Variant-specific droid images** — `createDroidVisual` now tries a variant-specific image first (e.g. `puffkin-platinum.png`) before falling back to the base species image, then the placeholder icon.
- **Droid Storage sort refined** — within the "not farming" group, droids now sort by rarity → species name → variant tier, instead of just rarity.
- **Capture minigame difficulty tuned** — Common/Uncommon capture zones tightened (44%→34%, 32%→24% of the track) per playtest feedback that they were too easy; Rare/Legendary unchanged, Cosmic given its own (very narrow) zone width.

## Beta feedback round 3 (small UI fixes)

- **Inventory visibility** — Paint and Nova Chips were already being fetched from the server but never actually displayed anywhere. Added an Inventory section in the Workshop panel showing both counts.
- **Owned droids sorted** — droids assigned to a workshop slot (farming) now always show first, in slot order; everything else follows sorted by rarity (Common → Cosmic), with a small divider label between the two groups.
- **Dex variant indicators redone** — replaced the earlier badge/symbol approach with three simple colored dots per species (Rusty, Platinum, Funky, in that order), lit up only once that variant has actually been caught. Verified the sort logic directly against real captured-droid data before shipping.

## Beta feedback round 2 (major addition — pre-3-day-test build)

**New systems:**
- **Login (username + PIN)** — replaces the old username-only signup. `POST /players { username, pin }` is now unified login/signup: new username creates a player, existing username + matching PIN resumes it on any device, existing username with no PIN yet set (pre-login-system accounts) claims whatever PIN is entered as a one-time migration. PIN is stored in plain text — deliberately "soft," fine for trusted friends, not for real users.
- **Release/scrap droids** — `POST /droids/:id/release` refunds 1.5x whatever crystals it cost to capture (0 for free/starter droids), plus a 10% chance of a Nova Chip.
- **Time-exclusive event cooldown** — 12 hours per target (collection or explicit species set) before the same event can be relaunched; enforced server-side in `createEvent()`.
- **Rarity-scaled droid leveling + HP/Attack stats** — leveling cost now multiplies by rarity (Legendary costs 4x a Common's cost at the same level — verified: level 5 costs 525 vs 131). Every droid also now has `hp`/`attack`, scaling with level the same way crystal rate does — groundwork for a future PVE raid system, deliberately deferred this round.
- **Paint → Funky evolution** — any successful capture has a 5% chance to drop 1 Paint (banked, generic currency). Spend `FUNKY_EVOLVE_PAINT_COST` (10, tunable in `db.js` — not specified in the original design ask) Paint on an owned Rusty droid to evolve it to "Funky" — a chosen primary color (red/yellow/blue) and a 350% crystal multiplier (midpoint between Rusty's 200% and Platinum's 500%).
- **Species evolution (Leafkin → Bushy)** — first entry in an extensible `EVOLUTION_TABLE`. Bushy is evolution-only (`spawnWeight: 0`, never appears in the wild). Costs 15 Nova Chips, which drop at 10% specifically from *releasing* droids (distinct from Paint, which drops from *capturing*).
- **Companion droids (StarSprite)** — a 5th tier ("cosmic"), rarer than Legendary, spawning at 1/10th normal variant odds. Doesn't farm or occupy a workshop slot — instead, one equipped companion applies a flat +50% buff to *total* crystal production (verified live: 0.0167/s → 0.025/s, exactly 1.5x). Only one can be equipped at a time.
- **Cosmetics** — pure crystal sink, no gameplay effect. One item this round: Beta Crown, 1000 crystals.
- **Guilds** — player-created, join by ID, up to 12 members, no gameplay effect yet — foundation for a future PVP/guild system.
- **Redeem codes** — `POST /redeem-codes` (admin-only, see below) creates a code granting crystals and/or a specific droid; `POST /redeem` uses it, once per player, with an optional total-use cap.

**Fixes:**
- **Bug: droids could stack in one workshop slot** — `assignDroidToSlot()` never checked for an existing occupant. Now rejects with a clear error. (Fixed in the previous round, re-verified this round.)
- **Bug: "Droids" stat in the Pilot panel always showed 0** — the UI element existed but nothing ever wrote to it. Now updates on every workshop refresh.
- **Bug: restored players/droids could crash on newer features** — `importState()` backfills defaults for any field added after a given snapshot was saved (see Round 1 for the original fix; extended this round to cover all the new player/droid fields above).

**UI/UX changes:**
- Manual latitude/longitude/radius fields removed — the terminal now only supports "Use My Location & Scan," which auto-scans on a fixed default radius.
- Owned droids now show rarity, HP, and Attack, plus buttons for leveling, both evolution types (where eligible), and release.
- The capture button is renamed **LOCK-ON**.
- Dex entries show small badges for which variants (Platinum/Rusty/Funky) have been caught per species, not just whether the species itself has been caught.
- New UI sections: Companion slot, Cosmetics (owned + shop), Guild (create/join/leave), Redeem Code — all under the Pilot panel.
- Capture failure messages now explicitly state the crystals lost (confirms — this was already true server-side; the UI just didn't say so).

**Verified live** (via direct HTTP calls against the running server, not just unit tests): login/resume/wrong-PIN rejection, release refund math, cosmetics purchase, guild creation, redeem-code single-use enforcement, the event-cooldown-boosted spawn search finding and capturing an actual StarSprite, and the companion buff's exact 1.5x multiplier on total crystal production.

**Not yet built:** full PVE raid combat (deferred by agreement — HP/Attack stats exist as groundwork, but nothing consumes them yet), guild-vs-guild PVP (guilds are membership-only for now), and real character art (droids still use procedurally-generated placeholder icons plus optional real images you supply via `assets/droids/`).

## Beta feedback round 1 (live-tester fixes)

- **Bug fix: restored players could crash on newer features** — `importState()` in `db.js` now backfills default values (`padLevel`, `dexSeen`, droid `level`/`variant`/`workshopSlotId`) for any player/droid saved by older code that predates those fields. Without this, a tester whose progress was saved before e.g. the Dex feature existed would hit a crash the next time they tried to use it, after any future deploy. Verified directly: simulated a snapshot missing those fields, confirmed it restores cleanly and the previously-crashing code paths now work.

- **Real droid artwork** — drop images into `assets/droids/` using the filenames listed in `assets/droids/README.md` (e.g. `puffkin.png`) and they'll appear automatically in the Dex, spawn cards, and owned-droid list — no code changes, no restart. Any species without an image yet keeps showing its procedural placeholder icon, so you can add art gradually. Tries `.png` → `.jpg` → `.jpeg` → `.webp` → `.gif` → `.svg` in that order per species. Served via a new `GET /assets/droids/<filename>` route with strict filename validation (this is public-internet-facing, so path-traversal attempts are rejected).

- **Persistent sessions** — the terminal now saves your player ID in the browser (`localStorage`) and auto-resumes on refresh instead of creating a new player every time. A "New Pilot (reset)" button clears this if you want to start over.
- **Real location** — a "📍 Use My Location" button in the Radar panel requests the browser's geolocation and auto-fills + scans, instead of requiring manual lat/lng entry.
- **Bug fix: multiple droids per slot** — `assignDroidToSlot()` in `workshop.js` previously never checked whether a slot was already occupied, so players could stack unlimited droids into one slot, bypassing the entire slot-unlock economy. Now rejects the assignment with a clear error if the slot holds a different droid. Verified with a direct test.
- **Droid Dex** — a collection tracker (`GET /players/:id/dex`) showing all 16 species with caught/uncaught status and completion %. Tracked via a `dexSeen` list on the player record (not current ownership), so a species stays "caught" even after you trade the droid away. Shown as a new panel with procedural icon art (see below) and a "???" silhouette for anything not yet caught.
- **Placeholder droid art** — no image-generation tool is available in this environment, so instead of leaving droids as bare text, each species gets a small procedurally-generated SVG icon (body color from alignment, accent shape from collection — leaf for Nature, wing/flame for Mythical — and a glow ring for higher rarities). This is clearly a placeholder, not final character art; commissioning real art (or running it through an AI image tool) is the natural next step for the mobile app phase.
- **Capture is now an actual timing minigame** — the old accuracy slider (set-and-forget, no skill involved) is replaced with a marker that sweeps back and forth across a track; a capture zone's width scales with rarity (wide for Common, narrow for Legendary), and stopping the marker closer to the zone's center earns higher accuracy, which still feeds the same server-side `padSkillMultiplier` as before.

## Visual test terminal

Open `test-terminal.html` directly in a browser (double-click it, or drag it into a tab) while the server is running. Deploy a pilot (or resume your last session automatically), pick a starter droid, use your real location or enter coordinates, time the moving marker to capture, watch your crystal balance tick up live, unlock extra workshop slots, level up droids, upgrade your pad, launch test events, trade with another player ID, and track your Dex completion — all from the UI now, with live JSON logged at the bottom.

**Trading tip for solo testing:** open the terminal in two browser tabs (or two browser profiles) and deploy a separate pilot in each — then use the second pilot's player ID as the trade target in the first tab.

## Endpoints

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| GET | `/species` | — | Full droid species catalog, incl. min crystal cost per rarity |
| POST | `/players` | `{ username }` | Create a player (seeds 10 workshop slots, 1 unlocked) |
| GET | `/players/:id` | — | Fetch player state |
| GET | `/players/:id/dex` | — | Full species catalog annotated with caught/uncaught + completion % |
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
| POST | `/events` | `{ name, mode? ('boost'\|'grant'), speciesIds? or collection?, spawnWeightMultiplier?, grantWeights?, startTime, endTime, adminCode }` | Create a time-exclusive spawn event — **admin-only, requires `adminCode: "2026"`** |
| POST | `/trades` | `{ fromPlayerId, toPlayerId, offeredDroidIds?, offeredCrystals?, requestedDroidIds?, requestedCrystals? }` | Propose a trade |
| GET | `/trades/:playerId` | — | List all trades (any status) involving this player |
| POST | `/trades/:id/accept` | `{ playerId }` | Accept a pending trade (must be the recipient) |
| POST | `/trades/:id/decline` | `{ playerId }` | Decline a pending trade (either participant) |
| POST | `/droids/:id/release` | `{ playerId }` | Scrap a droid for 1.5x captureCost refund + 10% Nova Chip chance |
| POST | `/droids/:id/evolve-species` | `{ playerId }` | Spend Nova Chips on a species evolution (e.g. Leafkin → Bushy) |
| POST | `/droids/:id/evolve-funky` | `{ playerId, color }` | Spend Paint on a Rusty droid → Funky (color: red/yellow/blue) |
| POST | `/companion/assign` | `{ playerId, droidId }` | Equip a companion droid (only one active at a time) |
| POST | `/companion/unassign` | `{ playerId }` | Unequip the current companion |
| GET | `/cosmetics` | — | Cosmetics catalog |
| POST | `/players/:id/cosmetics/buy` | `{ cosmeticId }` | Purchase a cosmetic |
| GET | `/guilds` | — | List all guilds (for browsing to join) |
| POST | `/droids/release-bulk` | `{ playerId, droidIds: [] }` | Release multiple droids in one settled action |
| GET | `/wishlist` | — | Public board of active (unfulfilled) wishes |
| POST | `/wishlist` | `{ playerId, wishType, speciesId?, variantWanted?, colorWanted?, note? }` | Post a wish |
| POST | `/wishlist/:id/cancel` | `{ playerId }` | Remove your own wish |
| GET | `/guilds/:id` | — | Guild details/members |
| POST | `/guilds` | `{ playerId, name }` | Create a guild (auto-joins creator) |
| POST | `/guilds/:id/join` | `{ playerId }` | Join a guild |
| POST | `/guilds/leave` | `{ playerId }` | Leave your current guild |
| POST | `/redeem` | `{ playerId, code }` | Redeem a promo code |
| POST | `/redeem-codes` | `{ code, rewardCrystals?, rewardSpeciesId?, maxUses?, adminCode }` | Create a promo code — **admin-only, requires `adminCode: "3103"`** |

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
