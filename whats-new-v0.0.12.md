# Sparkfield — What's New (0.0.11 & 0.0.12)

Two rounds combined into one document, since 0.0.11 hadn't been fully
reviewed before 0.0.12 landed on top of it.

---

## 0.0.11 — Theme, Home Page, Shop, Two New Droid Lines

**Theme renaming:** Farm → Foundry, Capture → Override, Storage →
Warehouse, "Attempt Egg" → "Attempt Prototype".

**Home Page:** shows on every startup — your logo (with text
fallback), an auto-updating poster gallery (drop images in, nothing
else to touch), and a written summary of each update.

**Shop:** buy every material except crystals directly — Paint, Nova
Chips, Beacons, Augment Cores, Light Stone, Dark Crystal, Time Warp,
Growth, and all outfits. Deliberately heavy prices.

**Economy & difficulty:** capture cost scales with Pad Level; the
Rusty/Platinum "too common" issue was a testing flag left on by
accident (was 10% each, now the intended 1/1000); capture zones
tighten further past Pad Level 10; new Time Warp/Growth single-use
items; a 3-second cooldown between capture attempts.

**Two new droid lines:** Void Zombies (Dark, 11pm-1am daily) and Lumen
Sentinels (Light, 11am-1pm daily).

**Warehouse rework:** decluttered to Level Up/Release only, droids
group by rarity, search bar added, opt-in auto-release-duplicates
toggle.

**Companions:** StarSprite now needs activating too (2hr/8hr); The
Enforcer added (+100% battle damage, groundwork for PVE).

**Guilds:** purchasable badges (Dark Side/Light Side), a leader-edited
Guild Notice separate from chat.

**Dex:** click any species for stats or its evolution path; Event Dex
reorganized into selectable decks.

**Radar:** live location map, Beacon visibility for anyone nearby (not
just the holder), boost markers on spawn cards showing event/Beacon
influence.

**Quality of life:** Change PIN, fixed the redeem-code popup, custom
iOS home-screen icon, admin codes moved out of plain-text source.

---

## 0.0.12 — Bug Fixes, Full Evolution Chains, Map Overhaul, QOL Pass

**Real bugs found and fixed:**
- Starter picker was showing every Common-tier species from every
  collection, but the backend only ever allowed the original 4 — most
  clicks silently failed. Now shows only the 4 real options.
- Event Dex was revealing its content immediately instead of waiting
  for a deck button press. Now stays hidden until tapped, tap again to
  hide. Relabeled back to "Dex" (not "Deck").
- Control Pad background and the Light/Dark/Cosmic backgrounds were in
  swapped locations — pad art now sits behind the Player tab's Control
  Pad section, alignment art now lives inside the actual capture
  minigame track.
- **A deeper Dex bug**, found while testing the new evolution chains:
  any species that was itself an evolution *target* got silently
  dropped from the Dex entirely once anything evolved past it a second
  time — meaning 3rd/4th-tier species in a chain never appeared. Fixed
  by walking the full chain instead of stopping after one link.

**Void Zombies & Lumen Sentinels — full 4-tier redesign:** only the
Common tier spawns wild now; Uncommon, Rare, and Legendary are all
evolution-only, each showing the "evolution-only" badge and its
correct evolution path in the Dex (previously only the Legendary tier
showed it).

**Live map overhaul:**
- Nearby droids now appear as markers directly on the map — tap one to
  jump straight to that droid's capture card below.
- Spawn density tuned for a reliable nearby spread on a single scan
  (previously relied on repeat visits to build up).

**Pad leveling economy recalibrated:**
- Crit chance now +0.5%/level (was +1%), applied live to every
  existing player.
- Costs escalate in real steps after Pad Level 10 and again after 20.
- Every 5th level also needs 1 Pad RAM (new material) — for now, Shop
  is the only source, since its intended PVE-drop source doesn't exist
  yet.

**QOL pass:**
- Auto-release now has a second toggle to also include Rusty/Platinum
  duplicates (variant-matched exactly — Funky is never included).
- PIN changes and guild creation/joining now show proper result
  popups instead of an easy-to-miss console log.
- Player tab: Control Pad and Outfit are now visibly separate boxes,
  outfit shown much larger, click any outfit for a full-size view.
- Change PIN / New Pilot buttons shrunk and moved to the bottom.
- Depot and Beacon now sit side-by-side.
- The "already caught" marker on spawn cards is now a bright checkmark
  instead of an icon that clashed with the new backgrounds.

---

*Still on the roadmap, not in either release: PVE/PVP Battles,
Mastery, Repair Kits, Breeding, Achievements, Hotspots, and the
Galactic Depot overhaul.*
