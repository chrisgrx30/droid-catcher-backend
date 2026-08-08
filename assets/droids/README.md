# Droid Artwork

Drop your droid images in this folder using the exact filenames below (all
lowercase, no spaces, matching the species name). The terminal picks them
up automatically — no code changes, no restart needed.

**Supported formats:** `.png` (preferred — supports transparency), `.jpg`,
`.jpeg`, `.webp`, `.gif` (animated GIFs work too), or `.svg`. If a droid
has no image here yet, the terminal falls back to its procedural
placeholder icon automatically, so you can add art gradually without
breaking anything.

**Recommended size:** square, at least 200×200px. Larger is fine — the
terminal scales images down as needed.

**Variants (Rusty/Platinum):** you can optionally add a dedicated image
per variant too — e.g. `puffkin-platinum.png`, `puffkin-rusty.png` — tried
before the base image. If you skip these, the base image is shown with an
automatic CSS tint instead (rust tone for Rusty, chrome tone for
Platinum), so dedicated variant art is a nice-to-have, not required.

## Filenames needed (64 total)

### ☀ Light — Mythical
- `puffkin.png` — Puffkin (Common)
- `emberfox.png` — Emberfox (Uncommon)
- `skylantern.png` — Skylantern (Rare)
- `aurumwing.png` — Aurumwing (Legendary)

### 🌑 Dark — Mythical
- `gloomrat.png` — Gloomrat (Common)
- `nightfang.png` — Nightfang (Uncommon)
- `ravencowl.png` — Ravencowl (Rare)
- `voidforge.png` — Voidforge (Legendary)

### ☀ Light — Nature
- `leafkin.png` — Leafkin (Common)
- `bloombot.png` — Bloombot (Uncommon)
- `vineweave.png` — Vineweave (Rare)
- `elderwood.png` — Elderwood (Legendary)
- `bushy.png` — Bushy (evolution-only, from Leafkin)

### 🌑 Dark — Corrupted Nature
- `thornstalk.png` — Thornstalk (Common)
- `sporecap.png` — Sporecap (Uncommon)
- `wiltroot.png` — Wiltroot (Rare)
- `voidtree.png` — Voidtree (Legendary)

### ☀ Light — Wildcard
- `teacupper.png` — Teacupper (Common)
- `pangolynk.png` — Pangolynk (Common)
- `toastybob.png` — Toastybob (Uncommon)
- `redwolfe.png` — Redwolfe (Uncommon)
- `brollybot.png` — Brollybot (Rare)
- `snowleopardon.png` — Snowleopardon (Rare)
- `packmate.png` — Packmate (Legendary)
- `oricalypse.png` — Oricalypse (Legendary)

### 🌑 Dark — Wildcard
- `binx.png` — Binx (Common)
- `shadowtad.png` — Shadowtad (Common)
- `tiktoker.png` — Tiktoker (Uncommon)
- `indrashark.png` — Indrashark (Uncommon)
- `snapshot.png` — Snapshot (Rare)
- `ghostcrane.png` — Ghostcrane (Rare)
- `gamebot.png` — Gamebot (Legendary)
- `vaantheris.png` — Vaantheris (Legendary)

### ✦ Companions (Cosmic)
- `starsprite.png` — StarSprite
- `nebulfox.png` — Nebulfox
- `theenforcer.png` — The Enforcer

### ☀ Light — Football (spawns Sat/Sun 3-5pm only)
- `scarforge.png` — Scarforge (Common)
- `plumebolt.png` — Plumebolt (Common)
- `gullstrike.png` — Gullstrike (Uncommon)
- `rivershield.png` — Rivershield (Uncommon)
- `hexasting.png` — Hexasting (Uncommon)
- `lionvolt.png` — Lionvolt (Rare)
- `magpiex.png` — Magpiex (Rare)
- `towerguard.png` — Towerguard (Rare)
- `spurwing.png` — Spurwing (Legendary)
- `skymane.png` — Skymane (Legendary)

### 🌑 Dark — Football (spawns Sat/Sun 8-10pm only)
- `cherrybyte.png` — Cherrybyte (Common)
- `ironfang.png` — Ironfang (Uncommon)
- `rootcore.png` — Rootcore (Uncommon)
- `emberhart.png` — Emberhart (Uncommon)
- `regalion.png` — Regalion (Rare)
- `hammerclad.png` — Hammerclad (Rare)
- `skytalon.png` — Skytalon (Rare)
- `cannix.png` — Cannix (Legendary)
- `redforge.png` — Redforge (Legendary)
- `liverflare.png` — Liverflare (Legendary)

### ☀ Light — Solar (Summer Event only, 7th-14th August)
- `sunbud.png` — Sunbud (Common)
- `solara.png` — Solara (Uncommon)
- `sundrift.png` — Sundrift (Rare)
- `solarisrex.png` — Solaris Rex (Legendary)

### 🌑 Dark — Solar (Summer Event only, 7th-14th August)
- `scorchling.png` — Scorchling (Common)
- `heatfang.png` — Heatfang (Uncommon)
- `dustwraith.png` — Dustwraith (Rare)
- `infernotitan.png` — Infernotitan (Legendary)

## How to add them

1. Rename your image files to match the list above exactly (case-sensitive
   on some hosts — keep everything lowercase, no spaces).
2. Drop them into this folder (`assets/droids/`).
3. Push to GitHub the same way as any other file update — Render will
   redeploy automatically and the images will just appear.

You don't need all 64 at once — add whichever you have now, and the rest
will keep showing their placeholder icon until you add the image.
