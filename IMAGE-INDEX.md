# Sparkfield — Image Asset Index

Every image the game can display, what it's for, and exactly where to
put it. Pulled directly from the current code (v0.1.0), not memory —
this should be 100% accurate to what's actually running.

**Format:** `filename` → what it is → folder

Drop a file in with the exact name below and it just works — no code
changes, no restart needed. Anything missing falls back gracefully
(placeholder icon, plain text, or nothing at all, depending on the
spot) — nothing breaks if you're missing some of these.

---

## assets/droids/ — 77 files

Every droid species in the game. All lowercase, no spaces (e.g.
"Solaris Rex" → `solarisrex.png`).

**Optional bonus:** add `<name>-rusty.png` or `<name>-platinum.png`
for a dedicated variant look (e.g. `puffkin-platinum.png`) — tried
before the base image. Skip this and the base image gets an automatic
colour tint instead, so it's a nice-to-have, not required.

### Mythical (8)
| Filename | Droid | Rarity |
|---|---|---|
| `puffkin.png` | Puffkin | Common |
| `gloomrat.png` | Gloomrat | Common |
| `emberfox.png` | Emberfox | Uncommon |
| `nightfang.png` | Nightfang | Uncommon |
| `skylantern.png` | Skylantern | Rare |
| `ravencowl.png` | Ravencowl | Rare |
| `aurumwing.png` | Aurumwing | Legendary |
| `voidforge.png` | Voidforge | Legendary |

### Nature (9)
| Filename | Droid | Rarity |
|---|---|---|
| `leafkin.png` | Leafkin | Common |
| `thornstalk.png` | Thornstalk | Common |
| `bloombot.png` | Bloombot | Uncommon |
| `sporecap.png` | Sporecap | Uncommon |
| `vineweave.png` | Vineweave | Rare |
| `wiltroot.png` | Wiltroot | Rare |
| `elderwood.png` | Elderwood | Legendary |
| `voidtree.png` | Voidtree | Legendary |
| `bushy.png` | Bushy (evolution-only, from Leafkin) | Uncommon |

### Wildcard (16)
| Filename | Droid | Rarity |
|---|---|---|
| `teacupper.png` | Teacupper | Common |
| `pangolynk.png` | Pangolynk | Common |
| `binx.png` | Binx | Common |
| `shadowtad.png` | Shadowtad | Common |
| `toastybob.png` | Toastybob | Uncommon |
| `redwolfe.png` | Redwolfe | Uncommon |
| `tiktoker.png` | Tiktoker | Uncommon |
| `indrashark.png` | Indrashark | Uncommon |
| `brollybot.png` | Brollybot | Rare |
| `snowleopardon.png` | Snowleopardon | Rare |
| `snapshot.png` | Snapshot | Rare |
| `ghostcrane.png` | Ghostcrane | Rare |
| `packmate.png` | Packmate | Legendary |
| `oricalypse.png` | Oricalypse | Legendary |
| `gamebot.png` | Gamebot | Legendary |
| `vaantheris.png` | Vaantheris | Legendary |

### Companions — Cosmic (3)
| Filename | Droid |
|---|---|
| `starsprite.png` | StarSprite |
| `nebulfox.png` | Nebulfox |
| `theenforcer.png` | The Enforcer |

### Football — Light side (10)
| Filename | Droid | Rarity |
|---|---|---|
| `scarforge.png` | Scarforge | Common |
| `plumebolt.png` | Plumebolt | Common |
| `gullstrike.png` | Gullstrike | Uncommon |
| `rivershield.png` | Rivershield | Uncommon |
| `hexasting.png` | Hexasting | Uncommon |
| `lionvolt.png` | Lionvolt | Rare |
| `magpiex.png` | Magpiex | Rare |
| `towerguard.png` | Towerguard | Rare |
| `spurwing.png` | Spurwing | Legendary |
| `skymane.png` | Skymane | Legendary |

### Football — Dark side (10)
| Filename | Droid | Rarity |
|---|---|---|
| `cherrybyte.png` | Cherrybyte | Common |
| `ironfang.png` | Ironfang | Uncommon |
| `rootcore.png` | Rootcore | Uncommon |
| `emberhart.png` | Emberhart | Uncommon |
| `regalion.png` | Regalion | Rare |
| `hammerclad.png` | Hammerclad | Rare |
| `skytalon.png` | Skytalon | Rare |
| `cannix.png` | Cannix | Legendary |
| `redforge.png` | Redforge | Legendary |
| `liverflare.png` | Liverflare | Legendary |

### Solar — Summer Event only (8)
| Filename | Droid | Rarity |
|---|---|---|
| `sunbud.png` | Sunbud | Common |
| `solara.png` | Solara | Uncommon |
| `sundrift.png` | Sundrift | Rare |
| `solarisrex.png` | Solaris Rex | Legendary |
| `scorchling.png` | Scorchling | Common |
| `heatfang.png` | Heatfang | Uncommon |
| `dustwraith.png` | Dustwraith | Rare |
| `infernotitan.png` | Infernotitan | Legendary |

### Void Zombies — 11pm-1am daily (4)
| Filename | Droid | Rarity |
|---|---|---|
| `shambler.png` | Shambler | Common |
| `walker.png` | Walker | Uncommon |
| `corruptor.png` | Corruptor (evolution-only, from Walker) | Rare |
| `voidlord.png` | Voidlord (evolution-only, from Corruptor) | Legendary |

### Lumen Sentinels — 11am-1pm daily (4)
| Filename | Droid | Rarity |
|---|---|---|
| `illume.png` | Illume | Common |
| `lumenguard.png` | Lumenguard | Uncommon |
| `luminor.png` | Luminor (evolution-only, from Lumenguard) | Rare |
| `luxion.png` | Luxion (evolution-only, from Luminor) | Legendary |

---

### Scaffitan — the Titan (5, new in v0.1.0)
Never wild-spawnable — obtained only via a rare chance (8%) after
winning a Titan battle, then masters through these tiers by spending
Energy Tubes.

| Filename | Droid | Rarity |
|---|---|---|
| `scaffitan.png` | Scaffitan | Common |
| `scaffitanprime.png` | Scaffitan Prime | Uncommon |
| `scaffitanascendant.png` | Scaffitan Ascendant | Rare |
| `scaffitanapex.png` | Scaffitan Apex | Legendary |
| `scaffitaneternal.png` | Scaffitan Eternal | Galactic |

---

## assets/outfits/ — 7 files

| Filename | Outfit | How it's obtained |
|---|---|---|
| `basic.png` | Basic | Free default, everyone starts with it (optional — falls back to a 👤 icon) |
| `earthy.png` | Earthy | Shop, 5000✦ |
| `technology.png` | Technology | Shop, 5000✦ |
| `wildlife.png` | Wildlife | Shop, 5000✦ |
| `funky.png` | Funky | Shop, 5000✦ |
| `void_warden.png` | Void Warden | Earned — complete the Void Zombie Dex line |
| `lumen_warden.png` | Lumen Warden | Earned — complete the Lumen Sentinel Dex line |

---

## assets/cosmetics/ — 1 file

| Filename | Item |
|---|---|
| `beta_crown.png` | Beta Crown (Shop, 1000✦, bragging rights only) |

---

## assets/misc/ — 6 files

| Filename | Where it's used |
|---|---|
| `egg.png` | Unassigned-egg icon in the Factory (Field Ops tab) |
| `control-pad.png` | Background behind the LOCK-ON capture minigame's sweep bar |
| `bg-light.png` | Background on radar spawn cards for Light-alignment droids |
| `bg-dark.png` | Background on radar spawn cards for Dark-alignment droids |
| `bg-cosmic.png` | Background on radar spawn cards for Cosmic-alignment droids |
| `working.gif` | Small animation on an active Farm/Foundry slot (needs to actually be a `.gif` to animate) |

---

## assets/home/ — 2 files

| Filename | Where it's used |
|---|---|
| `logo.png` | Home page header (falls back to plain text "Sparkfield" if missing) |
| `icon.png` | iOS home-screen icon when the app is saved as a shortcut |

## assets/home/posters/ — any number of files, any filenames

No fixed names — drop any image in here and it's automatically shown
on the Home page. Landscape recommended. Delete a file and it
disappears from the page immediately, no other step needed.

---

## Grand total (fixed-name files)

**77 droid images** + **7 outfit images** + **1 cosmetic image** +
**6 misc images** + **2 home images** = **93 fixed-filename images**,
plus unlimited posters.

You don't need all 93 at once — add whichever you have, the rest keep
showing their placeholder/fallback until you get to them.

---

## Materials & Items — Full List

Every material/item currently in the game: how it's obtained, whether
it's buyable, and what it's used for. Pulled directly from the live
shop catalog and game logic.

| Item | Buyable in Shop? | Other ways to get it | Used for |
|---|---|---|---|
| **Crystals** | — (the currency itself) | Foundry farming, Depot visits | Everything — captures, upgrades, evolutions, shop purchases |
| **Paint** | ✅ 150✦ | 5% drop on capture, 12% from Depot | Funky evolution (10 Paint) |
| **Nova Chips** | ✅ 250✦ | 10% drop on release, 5% on crushing a Factory egg, 12% from Depot | Every species evolution (base cost, varies by tier) |
| **Beacon** | ✅ 300✦ (also a dedicated Field Ops "Buy" button, same price) | — | 30-min Rare+ spawn boost, visible to anyone nearby, not just the holder |
| **Augment Core** | ✅ 400✦ | 10% from Depot | Intended for HP/Attack customization — **no spend mechanic built yet**, currently just accumulates |
| **Light Stone** | ✅ 500,000✦ | — | Corruptor → Voidlord evolution (Void Zombie line) — deliberately cross-alignment (a Dark-line droid needs a Light material) |
| **Dark Crystal** | ✅ 500,000✦ | — | Luminor → Luxion evolution (Lumen Sentinel line) — same cross-alignment design, reversed |
| **Pad RAM** | ✅ 5,000✦ | Intended: 5% PVE Battle drop — **not live yet, Shop is the only source for now** | Required every 5th Pad Level (5, 10, 15...) alongside the crystal cost |
| **Repair Kit** | ✅ 1,500✦ | Titan battle win reward (1 per win) | Fully heals one fainted droid |
| **Energy Tubes** | ❌ not purchasable | Titan battle rewards (4-7 on a win, 1-2 on a loss), or releasing a duplicate Scaffitan (1-5, weighted toward 1) | Scaffitan's mastery progression (15 → 40 → 75 → 150 per tier) |
| **Time Warp** | ✅ 100✦ | — | Slows the capture sweep bar for one attempt. Single-use, consumed the moment it's applied, win or lose |
| **Growth** | ✅ 100✦ | — | Widens the capture zone for one attempt. Same single-use rule as Time Warp |
| **Outfits** — Earthy/Technology/Wildlife/Funky | ✅ 5,000✦ each | — | Cosmetic, equip from the Player tab |
| **Outfits** — Void Warden / Lumen Warden | ❌ not purchasable | Earned — fully complete the Void Zombie or Lumen Sentinel Dex line | Cosmetic, same as above once earned |
| **Outfit** — Basic | ❌ not purchasable | Free, everyone starts with it equipped | Cosmetic default |
| **Beta Crown** | ✅ 1,000✦ (Cosmetics catalog, not the main Shop list) | — | Cosmetic only, no gameplay effect |
| **Guild Badge** — Dark Side / Light Side | ✅ 5,000✦, but bought directly by the guild leader through the Guilds tab, not the main Shop | — | Guild-level cosmetic identity |

**Not yet real materials, just noted as future ideas** (mentioned once,
nothing built): Mod Chips, USB Dongles, Glass Bottles — planned as
battle-related buff items once Battles exist.

