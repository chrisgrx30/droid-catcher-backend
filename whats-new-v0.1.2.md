# Sparkfield — What's New in 0.1.2

## Real bugs fixed
- **StarSprite always showed "ACTIVE"** regardless of whether you'd
  actually activated it — the underlying crystal math was always
  correct, this was a display-only bug.
- **"Capture results not opening"** — confirmed cause: attempting to
  capture a spawn you'd already fled from gave a confusing "Spawn
  already captured" message (or in earlier builds, nothing at all).
  Now says plainly: "You already ran from this one — it's gone for
  good."
- Fleeing a capture now requires confirmation and shows a clear
  result popup — previously completely silent.
- Investigated the Enforcer "too easy to get" report thoroughly:
  confirmed its spawn rate is mathematically identical to StarSprite
  and Nebulfox, and the shared cosmic-rarity cap applies to all three
  equally. No imbalance found in the numbers — flagged rather than
  patched, since I couldn't find anything to fix.

## Shop
- Category browsing — Materials, Outfits, and Cosmetics are now
  collapsible sections you tap into, like the Warehouse.
- Quantity +/- moved below the item name instead of crowding the
  right side.
- Redeem Code moved here from Inventory.

## Player tab
- PIN fields now stack vertically with New Pilot (reset) below them,
  left-aligned; Outfit box sits alongside so their bottoms align.

## Everywhere
- Foundry slots now show rarity below level/rate.
- Trade dropdowns show rarity and variant, not just level.
- Battle tab reordered: your selected team preview at the top, the
  team picker itself at the bottom.
- Summer Dex button is genuinely orange now (previously always cyan
  regardless of collection).
- Warehouse: a Repair button right on fainted rows.
- Clean Up Duplicates button now looks like a real (red) button.

## Panel backgrounds — new system
19 panels across the whole game now support a custom background
image — same PNG-or-GIF-with-fallback approach used everywhere else.
See `PANEL-BACKGROUNDS-INDEX.md` for the exact filename each one
needs.

---

*Still open: Guild Shop themes and Processor slot icons — noted, not
built this round.*
