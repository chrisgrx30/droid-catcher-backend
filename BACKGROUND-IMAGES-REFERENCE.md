# Sparkfield — Background & Image Reference (v0.2.0)

Where every image file lives, and which part of the game it appears in.

## How the system works

`applyPanelBackground(elementId, name, folder)` in `test-terminal.html`
tries `<name>.png` first, then `<name>.gif`. If neither exists the panel
keeps its normal solid colour. **Nothing breaks if a file is missing** —
add art gradually, no code changes, no restart needed.

A dark overlay is applied automatically over every background so text
stays legible.

Default folder is `assets/misc/`. Only the Apex panel uses a different
one.

---

## Folders and their HTTP routes

| Folder on disk | Served at | Contains |
|---|---|---|
| `assets/droids/` | `/assets/droids/` | The 230+ droid species images |
| `assets/apex/` | `/assets/apex/` | **New in v0.2.0** — Apex panel backgrounds |
| `assets/misc/` | `/assets/misc/` | Nearly all panel backgrounds |
| `assets/cosmetics/` | `/assets/cosmetics/` | Cosmetic item icons |
| `assets/outfits/` | `/assets/outfits/` | Player outfit images |
| `assets/battle/` | `/assets/battle/` | Battle stat icons (hp, attack, special, repairkit) |
| `assets/home/` | `/assets/home/` | Home logo and icon |
| `assets/home/posters/` | `/assets/home/posters/` | Home tab promo posters |
| `assets/materials/` | **no route** | ⚠️ Unreachable — see note at the bottom |

**Accepted extensions:** `.png` (preferred), `.jpg`, `.jpeg`, `.webp`,
`.gif` (animated works), `.svg`.

**Filename rules:** letters, numbers, underscore and hyphen only. Spaces
or other characters are rejected by the server route with a 400.

---

## Panel backgrounds — full map

All of these go in **`assets/misc/`** unless the folder column says
otherwise.

### Capture tab

| File | Folder | Panel |
|---|---|---|
| `radarsweep` | misc | Radar Sweep panel |
| `outofrange` | misc | **New** — the "out of capture range" note on distant droid cards |
| `bg-light` | misc | Capture minigame track, Light droids |
| `bg-dark` | misc | Capture minigame track, Dark droids |
| `bg-cosmic` | misc | Capture minigame track, Cosmic droids |

### Battles tab

| File | Folder | Panel |
|---|---|---|
| `apexbattle` | **apex** | **New** — Apex Encounter box |
| `titanencounter` | misc | Titan Encounter box |
| `choosebattleteam` | misc | Choose Battle Team box |
| `yourbattleteam` | misc | Selected team preview strip |
| `challenger` | misc | Challenge a Player box |
| `activebattle` | misc | Active battle panel |
| `battles` | misc | Your Battles box |

### Admin tab

| File | Folder | Panel |
|---|---|---|
| `manualcoords` | misc | **New** — Manual Coordinates box |

### Player / Field Ops

| File | Folder | Panel |
|---|---|---|
| `pilot` | misc | Player tab main box |
| `themepicker` | misc | Theme picker |
| `depot` | misc | Field Ops — Depot |
| `beacon` | misc | Field Ops — Beacon |
| `factory` | misc | Field Ops — Factory / Prototypes |
| `offlineprojection` | misc | Offline earnings projection |
| `buffsummary` | misc | Active buffs summary |
| `friends` | misc | Friends box |

### Foundry / Workshop

| File | Folder | Panel |
|---|---|---|
| `workshop` | misc | Workshop main box |
| `workshopslot` | misc | Workshop Slots box |

### Guild

| File | Folder | Panel |
|---|---|---|
| `guild` | misc | Guild main box |
| `guildleaderboard` | misc | Guild leaderboard |
| `guildchat` | misc | Guild chat |

### Companion

| File | Folder | Panel |
|---|---|---|
| `companion` | misc | Equipped companion box |
| `yourcompanions` | misc | Your Companions list |

### Inventory / Shop / Trading

| File | Folder | Panel |
|---|---|---|
| `inventory` | misc | Inventory tab |
| `shop` | misc | Shop box (Redeem Code lives here too) |
| `trading` | misc | Trading main box |
| `wishlist` | misc | Wishlist box |

### Dex

| File | Folder | Panel |
|---|---|---|
| `dex` | misc | Droid Dex main box |
| `eventdex` | misc | Event Dex box (generic — hosts whichever event is live) |

### Warehouse

| File | Folder | Panel |
|---|---|---|
| `warehouse` | misc | Owned Droids box |
| `warehousemaintenance` | misc | Warehouse maintenance box |

### Wardrobe

| File | Folder | Panel |
|---|---|---|
| `wardrobe` | misc | Wardrobe main box |

---

## Images that are NOT part of the panel system

| Path | Purpose |
|---|---|
| `assets/home/logo.png` | Home tab — full background of the What's New panel |
| `assets/home/icon.png` | App icon |
| `assets/home/posters/*.png` | Home tab promo posters (players can react/dismiss) |
| `assets/battle/hp.png`, `attack.png`, `special.png`, `repairkit.png` | Battle stat icons |
| `assets/droids/<species>.png` | Droid art — see below |
| `assets/cosmetics/<id>.png` | Cosmetic icons, named by catalogue id |
| `assets/outfits/<id>.png` | Outfit images, named by outfit id |

### Droid art naming

Lowercase species name with spaces removed: `puffkin.png`,
`voltrix.png`, `scaffitanprime.png`.

Variant art is optional and takes priority when present:
`puffkin-platinum.png`, `puffkin-rusty.png`. Without it the base image
is CSS-tinted automatically.

**Hyphens (fixed in v0.2.0):** the client now tries the hyphenated form
first, then the de-hyphenated form. So `Corsair-X` matches either
`corsair-x.png` or `corsairx.png`. Both conventions work — you no longer
need to rename anything.

All 30 Apex droid images are already in `assets/droids/` and working.

---

## Slots ready but not yet used

| File | Folder | Intended for |
|---|---|---|
| `apexhunt` | apex | Apex Hunt admin panel — route and folder exist, not wired to a panel yet |

---

## ⚠️ `assets/materials/` is unreachable

`assets/materials/` contains `energytube.png` and `repairkit.png`, but
**`server.js` has no route for that folder**, so neither file can be
loaded over HTTP. Note that `repairkit.png` also exists in
`assets/battle/`, which *is* served — that copy works.

Two options: add an `/assets/materials/` route mirroring the others, or
move the files into `assets/misc/`. Pre-existing, not introduced in
v0.2.0.
