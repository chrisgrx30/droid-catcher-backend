# Sparkfield — What's New in 0.0.11

Renamed to Sparkfield, a huge batch this round — full action plan from
our last planning session, completed.

---

## Theme renaming
- Farm → **Foundry**
- Capture → **Override**
- Storage → **Warehouse**
- "Attempt Egg" → **"Attempt Prototype"**

## Tab layout
Reorganized into the confirmed grid, Home added as a new default tab.

## Home Page
Shows on every startup: your logo (with graceful text fallback), a
poster gallery that auto-updates from a folder — drop images in,
nothing else to touch — and a written summary of what's new each round.

## Shop
Buy every material except crystals directly — Paint, Nova Chips,
Beacons, Augment Cores, the new Light Stone / Dark Crystal, Time Warp,
Growth, and all 4 outfits. Deliberately heavy prices — a shortcut for
players who can farm large amounts, not a replacement for earning
things normally.

## Economy & Difficulty
- **Capture cost now scales with Pad Level** — a real crystal sink so
  upgrades don't just let crystals pile up unused.
- **Rusty/Platinum odds fixed** — a testing flag was accidentally left
  on, meaning variants were spawning at 10% each instead of the
  intended 1/1000. Fixed.
- **Capture zones tighten further** for Rare+ droids once your Pad
  Level passes 10 — the "maxed pad trivializes everything" problem,
  addressed directly.
- **Time Warp / Growth** — new single-use Shop items that slow the
  sweep bar or widen the capture zone for one attempt. Gone the moment
  they're used, win or lose.
- **3-second cooldown between capture attempts**, stops spam-clicking.

## Two New Droid Lines
- **Void Zombies** (Dark) — Shambler, Walker, Corruptor, Voidlord.
  Spawns 11pm-1am, every day.
- **Lumen Sentinels** (Light) — Illume, Lumenguard, Luminor, Luxion.
  Spawns 11am-1pm, every day.
- Only Common/Uncommon spawn wild — Rare and Legendary are
  evolution-only, and deliberately cost a cross-alignment material:
  the Dark line's final evolution needs a *Light* Stone, and vice versa.
- Fully complete either line's Dex and unlock a free outfit — **Void
  Warden** or **Lumen Warden**.

## Warehouse Rework
- Decluttered to just Level Up and Release on the main list — Assign
  and Evolve moved into a droid's detail popup.
- Droids now group into collapsible sections by rarity.
- Search bar to find a droid by name.
- **Auto-release duplicates** — an opt-in toggle (off by default) that
  automatically releases a newly-captured standard-variant Common or
  Uncommon droid if you already own that species. A Rusty or Platinum
  capture is never touched, even with the toggle on.

## Companions
- **StarSprite now needs activating too** (2hr active, 8hr cooldown) —
  every companion type requires activation now, none stay "always-on."
- **The Enforcer** — new Cosmic companion, +100% battle damage
  (groundwork for the upcoming PVE system).

## Guilds
- **Badges** — Dark Side / Light Side, 5000✦, leader-only.
- **Guild Notice** — a free-text summary box, separate from chat so it
  doesn't get buried.

## Dex
- Click any species for full stats (if caught) or its evolution path
  (if not).
- **Event Dex reorganized into selectable "decks"** — ready for however
  many event collections exist over time, instead of one growing pile.

## Radar / Override Tab
- **Live location map** — shows your actual position while scanning.
- **Beacon visibility** — see if *anyone's* Beacon (not just your own)
  is currently boosting the cell you're in.
- **Boost markers** — spawn cards now show a small icon if that droid
  was boosted by an active event or Beacon.

## Quality of Life
- **Change PIN** from the Player tab.
- **Redeem code popup fixed** — previously only logged quietly to the
  console; now shows a proper result popup with everything granted.
- **Custom iOS home-screen icon** support.
- Admin codes moved to environment variables, out of plain-text source.

---

*Still on the roadmap, not in this release: PVE Battles, the
Buddy/Mastery system, and Repair Kits — all deliberately deferred until
Battles' turn structure is designed.*
