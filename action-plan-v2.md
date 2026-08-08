# Sparkfield — Action Plan (post-0.0.10)

No code written yet — everything below is confirmed and ready to build
from. Organized by theme, not by original item number, so it reads as
a build spec rather than a meeting transcript.

---

## Mastery System

- A droid must be at max level (20) before it can become a **Buddy**
  (assigned from the Player tab).
- Can't farm while assigned as a Buddy.
- Gains Mastery Level automatically based on elapsed time since
  assignment — same compute-on-read pattern crystal farming already
  uses, no daily check-in required.
- Cap: **30 Mastery levels**, bringing the droid's effective final
  level to **50** (20 base + 30 Mastery).
- Crystal gain, HP, and Attack all scale up with Mastery level.
- **At max Mastery (30):** unlocks a second, special attack — a stun
  effect. Exact turn-based translation (stun = skip opponent's next
  turn; cooldown = usable once every N turns) gets finalized once
  Battles' turn structure is designed — this piece is genuinely linked
  to that system, not buildable in isolation.
- Unassigning a Buddy **pauses** progress (doesn't reset) — reassigning
  later resumes from where it left off.
- Releasing or trading away a Buddy **permanently loses** its Mastery
  progress (tied to that specific droid instance).
- **Release popup must warn clearly** if the droid being released has
  Mastery progress, before the player can confirm.
- Deferred alongside Battles (see bottom) — Mastery's whole payoff is a
  battle mechanic, so it waits for that turn structure to exist.

---

## Renaming (theme consistency pass)

- Farm tab → **Foundry**
- Capture tab/button/terminology → **Override**
- Storage tab → **Warehouse**
- Field Ops' "Attempt Egg" button → **"Attempt Prototype"**
- Lumen Sentinels' Uncommon tier: **Lumenguard** (was going to collide
  with the existing Beacon item name)

---

## Tab Layout Reorganization

Player tab stays in its current (first) position. New grid:
- **Row 1:** Override (Capture), Field Ops
- **Row 2:** Foundry (Farm), Guilds, Companion
- **Row 3:** Inventory, Trading, Dex
- **Row 4:** Warehouse (Storage), Admin

---

## Small UI / Layout Items

- Move "New Pilot (reset)" button to the bottom of the Player tab.
- Console log ("script") — **visible only on the Admin tab**, removed
  from every other tab's persistent view, so the normal UI looks
  polished with no visible debug output.
- Warehouse: add a search-by-name filter.
- Funky evolution color choice — replace the current `prompt()` dialog
  with a proper dropdown (red/yellow/blue).
- Player tab: add a **Change PIN** option near the bottom.

---

## Companion Tab

- Bigger visual for the currently-equipped companion (larger than the
  icon size used in Warehouse listings).
- Click it to open a details popup.
- **StarSprite now needs activation too** — 2 hours active, 8 hours
  cooldown (different active-duration than Nebulfox/Enforcer's 1
  hour). This means **no companion type stays "always-on while
  equipped" anymore** — all three now require activation. Technically:
  active-duration becomes configurable per companion species instead
  of one shared constant.
- Further "liven this section up" ideas — deferred to a dedicated
  brainstorm once Battles land (per your note: "trivial" to revisit
  then).

---

## Warehouse (Storage) Rework

- Declutter the main row to just **Level Up** and **Release** buttons.
- **Assign to slot** and **Evolve** move into the droid's detail popup
  (reached by clicking the droid) — reuses the existing stats-modal
  pattern, just extended with these two actions.
- Add **rarity-based sub-groups** (Common/Uncommon/Rare/Legendary/
  Cosmic), collapsible, for structure now that rosters have grown large.
- Add each droid's actual icon image to Farm/Foundry slot cards
  (confirmed real gap — slots currently only show a ☀/🌑 symbol, not
  the droid's own art, even though the lookup function already exists).
- **Auto-release-duplicates toggle** — off by default, opt-in,
  **Common/Uncommon rarity only**. Applies only to a *newly captured,
  standard-variant* droid where you already own that species (any
  variant) in storage — a new Rusty/Platinum capture is never
  auto-released, even if you already own a standard one.

---

## Guilds

- **2 purchasable guild badges** in the Shop: **Dark Side** and
  **Light Side** — guild leader assigns one to represent the guild.
  (Broader achievement-based badges deferred to the PVE system.)
- **Guild Notice** — a free-text summary box, leader-editable, separate
  from Chat so it doesn't get buried in scrolling messages.

---

## Dex

- **Event Dex becomes a selectable list of "decks"** (e.g. a "Summer
  Deck" button) rather than one fixed section — scales cleanly to
  however many event collections exist over time, without showing a
  wall of empty entries for events a player missed.
- Click a **caught** droid → see its full base stats.
- Click an **uncaught** droid → greyed placeholder, no stats shown.
- Click an uncaught droid that's part of an evolution chain → shows
  its evolution path (what it evolves from/to).

---

## Capture / Override Tab

- **Location map** — a real live map showing the player's current
  position, not just a styled coordinate readout. Bigger addition:
  needs a mapping library (e.g. Leaflet + a tile provider), not just
  CSS — flagged for proper scoping when we build it.
- Show the droid's PNG icon **above** the green checkmark on the
  capture-success popup.
- Show a **beacon-active indicator** if a Beacon is currently boosting
  the cell being scanned — needs new tracking, since beacon status is
  currently only checked against the requesting player's own Beacon,
  not "is anyone's Beacon active here."
- Show a **marker on a spawn card** if that spawn was boosted by an
  active event or Beacon — transparency into what's currently giving
  players an edge.
- **Run/Flee option** — back out of a capture attempt without engaging.
- **3-second cooldown between capture attempts**, server-enforced —
  confirmed this doesn't exist yet (the existing scan rate-limit only
  governs how often you can *scan*, not how often you can *attempt a
  capture*).

---

## Trading

- Show the wished droid's PNG icon on Wishlist board entries.

---

## Economy & Difficulty Tuning

- **Capture cost scales with Pad Level:** `effective minimum cost =
  base cost × (1 + 0.05 × pad level)`. At pad level 20 that's 2x base
  cost, at level 50 it's 3.5x — a real crystal sink that doesn't spiral.
- **Variant odds fixed:** `TESTING_HIGH_VARIANT_ODDS` flips to
  `false`. This was left on from early development — Rusty/Platinum
  are currently spawning at **10% each** live, not the intended
  **1/1000 (0.1%) each**. Flipping this one flag alone may fully
  resolve the "too many variants" feeling.
- **Difficulty scales with Pad Level:** capture zone width narrows
  further for Rare+ tiers once pad level passes a threshold (~10+),
  with a hard floor so it's never truly unwinnable — directly targets
  "maxed pad trivializes everything."
- **Two new Shop items:** **Time Warp** (slows the sweep bar for your
  next capture attempt) and **Growth** (widens the capture zone for
  your next attempt). 100✦ each. **Single-use — consumed the moment
  it's applied to an attempt, regardless of whether that attempt
  succeeds or fails.**

---

## New Droid Lines

### Void Zombies (Dark) — spawns 11pm-1am, every day
Common **Shambler** and Uncommon **Walker** are both independently
wild-spawnable (no evolution link between them).
- Uncommon → Rare (**Corruptor**): standard Nova Chip cost **plus**
  1000 crystals.
- Rare → Legendary (**Voidlord**): standard Nova Chip cost **plus** a
  **Light Stone**.
- **Light Stone** — new material, sold in the Shop for **500,000
  crystals**.

### Lumen Sentinels (Light) — spawns 11am-1pm, every day
Common **Illume** and Uncommon **Lumenguard** both independently
wild-spawnable.
- Uncommon → Rare (**Luminor**): standard Nova Chip cost **plus** 1000
  crystals.
- Rare → Legendary (**Luxion**): standard Nova Chip cost **plus** a
  **Dark Crystal**.
- **Dark Crystal** — new material, sold in the Shop for **500,000
  crystals**.

### Completion rewards
- Full Dex completion of the Zombie line → unlocks the **Void Warden**
  outfit.
- Full Dex completion of the Lumen line → unlocks the **Lumen Warden**
  outfit.

---

## Bug Fixes

- **Redeem code popup** — currently only logs to the small console
  feed (easy to miss), unlike every other action which shows a proper
  result popup. Fix to match the established pattern, and actually
  show Paint/Nova Chips granted (the server already returns this data,
  the UI just doesn't display it).

---

## Security Recommendation (not explicitly requested, flagging anyway)

Admin codes (`2026`/`3103`) and the seeded redeem codes are currently
hardcoded in plain text in `server.js`/`db.js`, which are as public as
any other file if the GitHub repo is public. Recommend moving these to
environment variables — same pattern already used for the Upstash
credentials — rather than leaving them in source.

---

## Home Page

- New screen, shown on **every app startup**.
- Contents: event posters, game logo in the header, a "key changes
  made" summary (a changelog display).
- Visuals: you'll supply — either attached directly in chat, or
  dropped into a folder once I confirm exact filenames.

## iOS Home Screen Icon

- Add an `apple-touch-icon` tag plus your custom icon asset, so saving
  Sparkfield to an iOS home screen uses your logo instead of a generic
  browser icon. Small, standard addition.

---

## Suggested Build Order

**Small, safe to batch together:** renames · tab reorg · console log
relocation · Warehouse search · funky color dropdown · Change PIN ·
redeem popup fix · variant odds flip · security env-var move · iOS icon

**Medium, a few numbers to nail down at build time:** capture-cost
formula · difficulty scaling · Time Warp/Growth · guild badges + notice
· Dex click-through (stats/evolution path) · Event Dex decks · Warehouse
rework (declutter + rarity groups + auto-release toggle) · capture
cooldown · new droid lines + their new materials

**Larger, needs real scoping when we get there:** live location map ·
beacon/event visibility on spawn cards · Home page (waiting on your
assets) · StarSprite activation (companion duration generalization)

**Deferred, waiting on Battles:** Mastery's special attack · Companion
tab "liven up" brainstorm · PVE Battles itself

---

Nothing built yet. Say the word whenever you want me to start.
