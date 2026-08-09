# Where to drop the v0.4 art

All five folders now exist and are served. Drop files straight in — the
routes are live and tested.

## ⚠️ Folder names: lowercase, no spaces

Render runs Linux, which treats `Achievements` and `achievements` as
different folders, and URLs can't contain raw spaces. Two of the names
in the spec would fail to load:

| Spec said | Use instead |
|---|---|
| `assets/Achievements/` | `assets/achievements/` |
| `assets/Levels/` | `assets/levels/` |
| `assets/Battle Equipment/` | `assets/equipment/` |

The file names inside are fine as-is.

## The folders

### `assets/achievements/`
`achi001.png` … `achi056.png` — one per achievement.

### `assets/levels/`
`lv001.png` … `lv020.png` — player level badges
`rb001.png` … `rb010.png` — Re-Boot badges

### `assets/attachments/`
15 icons. Names match the built catalogue exactly:

| Mod Chip (Common) | USB Dongle (Uncommon) | Energy Bottle (Rare) |
|---|---|---|
| `hpmodchip.png` | `hpusb.png` | `hpebot.png` |
| `atkmodchip.png` | `atkusb.png` | `atkebot.png` |
| `spcmodchip.png` | `spcusb.png` | `spcebot.png` |
| `crymodchip.png` | `cryusb.png` | `cryebot.png` |
| `rwdmodchip.png` | `rwdusb.png` | `rwdebot.png` |

Note the spec's icon list labelled every one of these "Common". The USB
Dongle and Energy Bottle tiers are Uncommon and Rare respectively —
corrected in the code.

Rarity borders are applied by the client from the item's tier, so the
icons themselves don't need borders drawn in.

### `assets/equipment/`
`emp.png`, `AugCore.png`, `repairkit.png`, `entube.png`, `gtoken.png`,
`growth.png`, `twrap.png`, `titantoken.png`

⚠️ `AugCore.png` has a capital A and C. The route accepts that, but keep
the capitals exactly — `augcore.png` won't be found.

### `assets/materials/`
This folder already existed with `energytube.png` and `repairkit.png`,
but had **no server route**, so neither file could ever load. Now
served. (`entube.png` in `assets/equipment/` supersedes
`energytube.png` — keep whichever you prefer.)

### `assets/droids/` — breeding droids
The 10 Astral Brood droids go in with every other species:
`astralmatron.png`, `voidpaladin.png`, `starwarden.png`,
`crystacore.png`, `forgegrub.png`, `nebulonix.png`, `gravimite.png`,
`sparkmite.png`, `dustbyte.png`, `orbitch.png`

### `assets/cosmetics/` — the 40 new pieces
Two-letter set prefix + body part, as specified:

| Set | Prefix | Files |
|---|---|---|
| Sunward | `sw` | `swhead.png`, `swbody.png`, `swarms.png`, `swlegs.png` |
| Duskraider | `dr` | `drhead.png`, `drbody.png`, `drarms.png`, `drlegs.png` |
| Aurora | `ar` | … |
| Nightshade | `ns` | … |
| Solaris | `sl` | … |
| Obsidian | `os` | … |
| Ascendant | `ac` | … |
| Dominion | `dm` | … |
| Astralis | `at` | … |
| Singularity | `sg` | … |

Same four suffixes for every set: `head`, `body`, `arms`, `legs`.

## Nothing breaks if a file is missing

Every image falls back gracefully — a missing icon shows a placeholder,
a missing background leaves the panel plain. You can add art in batches.
