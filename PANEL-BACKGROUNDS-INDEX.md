# Sparkfield — Panel Background Images (new in v0.1.2)

Every panel that now supports a background image. Drop a `.png` or
`.gif` with the exact filename below into `assets/misc/` — the game
tries `.png` first, then `.gif`, and falls back to the normal solid
panel color if neither exists. No code changes needed either way,
same as every other image system in the game.

All of these go in the **same folder**: `assets/misc/`

| Filename (`.png` or `.gif`) | Panel |
|---|---|
| `pilot` | Player tab — ID, Callsign, Crystals, Droids, Refresh, User Guide |
| `depot` | Field Ops — Depot box |
| `beacon` | Field Ops — Beacon box |
| `factory` | Field Ops — Factory/Prototypes box |
| `workshop` | Foundry — main Workshop box (balance, collect) |
| `workshopslot` | Foundry — Workshop Slots box |
| `guild` | Guild tab — main box |
| `companion` | Companion tab — main equipped-companion box |
| `yourcompanions` | Companion tab — "Your Companions" list box |
| `inventory` | Inventory tab |
| `shop` | Inventory tab — Shop box (Redeem Code now lives here too) |
| `trading` | Trading tab — main Trading box |
| `wishlist` | Trading tab — Wishlist box |
| `dex` | Dex tab — main Droid Dex box |
| `summerdex` | Dex tab — Event Dex box (reused for future events too — the filename is generic, not summer-specific, since the same box will host whichever event is running next) |
| `titanencounter` | Battles tab — Titan Encounter box |
| `challenger` | Battles tab — Challenge a Player box |
| `battles` | Battles tab — Your Battles box |
| `warehouse` | Warehouse tab — Owned Droids box |

**Home tab logo** works differently — it's not part of this system,
still its own dedicated file: `assets/home/logo.png`. It's now the
full background of the What's New panel (with a dark overlay for
legibility), rather than a separate image above it.

**Battle stat icons** are also separate, in their own folder:
`assets/battle/hp.png`, `attack.png`, `special.png` (documented
previously, unchanged this round).

---

## Quick copy-paste checklist

```
assets/misc/pilot.png (or .gif)
assets/misc/depot.png
assets/misc/beacon.png
assets/misc/factory.png
assets/misc/workshop.png
assets/misc/workshopslot.png
assets/misc/guild.png
assets/misc/companion.png
assets/misc/yourcompanions.png
assets/misc/inventory.png
assets/misc/shop.png
assets/misc/trading.png
assets/misc/wishlist.png
assets/misc/dex.png
assets/misc/summerdex.png
assets/misc/titanencounter.png
assets/misc/challenger.png
assets/misc/battles.png
assets/misc/warehouse.png
```

You don't need all 19 at once — add whichever you have ready, the
rest keep showing their normal solid background until you get to
them, exactly like every other optional image slot in the game.

---

*Not yet built: Guild Shop theme purchases (noted for the roadmap,
not started) and Processor slot icons — flagged as a planned item
but not wired into this round.*
