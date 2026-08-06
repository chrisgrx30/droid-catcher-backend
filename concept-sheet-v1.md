# Droid Catcher — Concept Sheet v1
## Light / Dark Droid Designs

**Art direction:** Cartoony and rounded — big expressive optic "eyes," chunky simplified limbs, no hard sci-fi edges. Every droid reads as an animal or mythical creature first, machine second (think "if a Pixar animal cosplayed as a robot," not "a robot shaped like an animal"). Silhouette should be readable at thumbnail size on a map pin.

**Alignment concept:** Each droid leans Light or Dark, both cosmetically (palette, motifs) and mechanically (sets up a future battle system — Light/Dark could work like a type matchup, or a resource meter players balance). Suggest adding an `alignment` field (`"light" | "dark"`) to the `droid_species` table alongside `rarity`.

---

## ☀ LIGHT SIDE

### 1. Puffkin — *Common* — Fairy / Dandelion Sprite
- **Silhouette:** Small and round, like a floating puffball. Two gossamer wing-panels (soft-edged, semi-transparent, lightly glowing) instead of propellers.
- **Palette:** Cream white body, pale mint-green glow lines, soft yellow optic.
- **Personality cue:** Bobs gently in place, wings flutter faster when a player approaches — curious, not scared.
- **Detail:** A tiny seed-pod antenna on top that sheds a spark of light like dandelion fluff when it moves.

### 2. Emberfox — *Uncommon* — Kitsune / Fox
- **Silhouette:** Sleek fox body on short legs, one long fiber-optic tail that glows warm amber and splits into 2–3 soft "flame" tail-tips (nods to the multi-tailed kitsune myth).
- **Palette:** Warm cream and burnt-orange plating, glowing amber tail and eye-visor.
- **Personality cue:** Playful, low crouch-and-pounce idle animation; tail flicker syncs with a soft chime sound.

### 3. Skylantern — *Rare* — Phoenix
- **Silhouette:** Rounded lantern-shaped body, paper-lantern-like glowing chest panel, small wing fins rather than full bird wings (keeps it cute, not fierce).
- **Palette:** Warm gold body, soft coral-pink underglow, trailing light particles like embers drifting upward.
- **Personality cue:** Slow, floaty movement — feels warm and reverent rather than aggressive. Rare-tier "glow pulse" on the map pin makes it stand out from a distance.

### 4. Aurumwing — *Legendary* — Griffin / Sun-Dragon Hybrid
- **Silhouette:** Compact but regal — griffin-esque head crest, small feathered-panel wings, lion-like haunches rendered in smooth plating (not literal fur/feathers, to keep it droid-coded).
- **Palette:** Radiant white-gold body, sunburst-pattern chest core, glowing white optics.
- **Personality cue:** Rare full-body idle "shine" animation (a sweeping light glint across the plating) — reserve big VFX moments like this for legendaries only, so they feel earned.

---

## 🌑 DARK SIDE

### 5. Gloomrat — *Common* — Scavenger Rat / Goblin
- **Silhouette:** Small, hunched, oversized round ears (functioning as little radar dishes), long thin tail with a blinking light on the tip.
- **Palette:** Charcoal-grey body, dull violet accent lines, single small red-orange optic.
- **Personality cue:** Twitchy, scurries side to side — reads as scrappy and low-threat, appropriate for the lowest tier.

### 6. Nightfang — *Uncommon* — Wolf
- **Silhouette:** Lean wolf body, low stance, angular "hackles" panel along the spine that lights up when alert.
- **Palette:** Deep navy-black plating, cool violet glow along joints and spine-panel, pale blue optics.
- **Personality cue:** Stalking idle loop (slow prowl side to side) rather than static — telegraphs it's a step up in threat/rarity from Gloomrat.

### 7. Ravencowl — *Rare* — Raven / Witch Hybrid
- **Silhouette:** Bird-humanoid hybrid — a raven head/beak silhouette on a small hooded-cloak-shaped body (the "cloak" is actually a pair of folded wing-panels, cartoon-witch coded without being a literal person).
- **Palette:** Glossy black-purple body, one glowing violet eye visible under the "hood," faint star-speckle texture on the wing-panels.
- **Personality cue:** Perches rather than hovers — sits still until approached, then a dramatic wing-panel "cloak flare" on capture attempt.

### 8. Voidforge — *Legendary* — Obsidian Dragon
*(keeping this name — it's already seeded in the backend's species list, so no data migration needed)*
- **Silhouette:** Compact dragon — short expressive snout, small wings, a coiled tail that wraps around its own feet when idle (cute-menacing, not scary-menacing).
- **Palette:** Matte obsidian-black body with glowing magenta-purple cracks running through the plating like lava seams, glowing void-purple eyes.
- **Personality cue:** Reserve the biggest "legendary glow" VFX for this one too — cracks pulse brighter the longer it's on screen, building anticipation before a capture attempt.

---

## Notes for later
- Light droids skew round/soft silhouettes and warm-to-cool pastel glow; Dark droids skew angular/sleek silhouettes and saturated jewel-tone glow (violet/magenta) — keeping this rule consistent across future droids will make Light/Dark instantly readable on the map even before a player is close enough to see detail.
- A battle system could use Light/Dark as a soft rock-paper-scissors axis (bonus damage/effect vs opposite alignment) or as a meter the player balances by owning both (design decision for later).
- Suggested schema addition: `droid_species.alignment TEXT -- 'light' | 'dark'`
