# Sparkfield — Locked Roadmap & Scope (post-0.1.0)

Everything confirmed across every planning conversation to date,
organized by version. This is the reference document — if a feature
isn't here, it isn't scoped yet.

---

## 0.2.0 — Depot / Galactic / Cosmetics / Attachments / Trading

The biggest single release on the roadmap — five systems bundled
together per your confirmed decision.

### Depot & Galactic Overhaul
- Depot cost moves to **10,000✦** per visit
- Full material reward pool per visit (every visit feels worthwhile,
  not just a gamble)
- **Galactic pity system**: lucky players hit their first Galactic
  within 5-10 visits, average 12-18, guaranteed by **30 visits hard
  pity**. Counter resets on obtaining a Galactic.
- **Galactic Fragments** — a Depot reward, combinable into a Galactic
  droid over time, giving visible progress alongside the RNG chase
- **2 launch Galactic droids** (confirmed, Titan excluded from this
  count):
  - **Depotus Prime** — buffs Depot rewards for the player
  - **Ovumen Arcanjx** — decreases Factory hatch time by 60%
  - *(Open: any other buffs, including player-vs-player debuffs, are
    welcome ideas from me — you'll handle final design/naming)*
- Rarity hierarchy locked: **Paint (60%) → Nova Chips (25%) → Plug-in
  material tier (7%) → Evolution Stone tier (2%)**, three rolls per
  visit

### Cosmetics Expansion
- **4 new slots**: Head, Body, Arms, Legs (alongside the existing
  Outfit slot)
- Rarity-based buffs: **Common +2%, Uncommon +4%, Rare +10%, Legendary
  +15%**
- **Head + Body → HP buff. Arms + Legs → Attack buff.**
- **VIP Crown becomes a Legendary Head cosmetic**
- **Wardrobe** storage area on the Player tab
- Recycle unwanted cosmetics into **Threads** (new material), spendable
  on new cosmetics

### Droid Attachments
- **3 attachment slots** per droid, assignable from the existing stats
  popup
- One attachment per droid, but a player can hold multiple attachments
  in reserve
- **Mod Chip** (Common): +5% HP, +5% Attack, Special: opponent skips 1
  extra turn, +5% passive crystal gain, +1 extra battle reward at 30%
  chance
- **USB Dongle** (Uncommon): +7% HP, +7% Attack, Special: player gets 1
  extra turn at battle start, +7% passive crystal gain, +2 extra
  rewards at 40% chance
- **Energy Bottle** (Rare): +10% HP, +10% Attack, Special: blocks
  opponent's first attack, +10% crystal gain, +3 extra rewards at 50%
  chance
- Reward screens show an icon when an attachment triggered a bonus,
  and buffs fold into totals shown elsewhere (e.g. Foundry crystal
  rate)

### Trading → Underground Store
- Renamed from "Trading"
- Material trades added: item-for-item, item-for-crystals,
  droid-for-item (not just droid-for-droid anymore)

### Needed from you before 0.2.0 numbers get locked
- Galactic droid images (Depotus Prime, Ovumen Arcanjx)
- Cosmetic images — how many distinct items per slot per rarity? (16
  minimum if it's 1 per slot per rarity, more if there's variety within
  a tier)
- Attachment images (you've mentioned having these already)
- Final Depot material pool quantities per tier
- Any Depotus Prime / Ovumen Arcanjx buff refinements, or debuff ideas
  you want to explore from my suggestions

---

## 0.3.0 — Breeding

- Breeding/Duplicator mechanism: any two droids can be used (species
  don't need to match)
- Output: 1 of **10 exclusive breeding droids** — **The Astral Brood**
  (full roster and visual design already provided):
  - Galactic: **Astralmatron** (the Queen)
  - Legendary: **Voidpaladin**, **Starwarden** (Royal Knights)
  - Rare: **Crystacore**, **Forgegrub** (Workers)
  - Uncommon: **Nebulonix**, **Gravimite** (Rideable mounts)
  - Common: **Sparkmite**, **Dustbyte**, **Orbitch** (Drones)
- A failed-breed chance exists so players keep trying rather than
  succeeding on the first attempt every time
- **Both input droids are lost permanently, regardless of outcome** —
  confirmed, no partial refund
- Heavy crystal cost — **80,000✦** figure discussed previously, to be
  reconfirmed against 0.2.0's finished economy before locking

### Needed from you before 0.3.0 build starts
- Astral Brood droid images (10, plus their confirmed recurring design
  language: mechanical shell + glowing core + orbital rings + crystal
  growths + cosmic energy conduits, escalating with rarity)
- Exact breed-success/fail probability curve, and whether it varies by
  which two droids are used or is flat regardless of input

---

## 0.4.0 — Player Leveling & Re-Boot

Full spec already provided and locked:
- **1 XP per qualifying action** (catching, hatching, winning a battle,
  completing a minigame, trading, evolving, using the Depot, etc.) —
  explicitly NOT passive crystal generation or menu interaction, to
  avoid exploits
- **Level 0 → 20**, full XP curve provided (Level 20 = 145,200 total
  XP)
- Milestone rewards every 5 levels (5/10/15/20), each with crystals +
  a badge, scaling up
- **Re-Boot** at Level 20: resets Level/XP progression only — droid
  collection, achievements, and all permanent unlocks are explicitly
  preserved
- Permanent **+2% bonus per Re-Boot**, alternating Crystal generation
  (odd Re-Boots) and Material rewards (even Re-Boots), **max Re-Boot
  10** initially (+10%/+10% at cap)
- Everything built **configurable, not hard-coded** — XP-per-level,
  XP-per-action, rewards, Re-Boot bonuses/max, all adjustable without a
  rebuild

### Needed from you before 0.4.0 build starts
- Nothing outstanding — this spec is complete and ready to build as
  written once we get here

---

## Achievements — needs a version slot

**Flagging this clearly: the full Achievements table (56 achievements,
Bronze/Silver/Gold/Gem tiers, individual buffs) was provided but has
not been assigned to a specific version above.** Given how tightly it
interlocks with Player Leveling (both are long-term progression
systems, and several achievements reference battle/Depot systems that
land in 0.2.0), the natural options are:
- **Bundle into 0.4.0** alongside Player Leveling (same "progression
  systems" release)
- **Its own dedicated version** between 0.3.0 and 0.4.0

This needs your call before the 0.4.0 scope is truly final.

---

## 0.5.0 — Full Balance Review & Live Infrastructure

- Complete economy/balance pass across the whole game, informed by
  everything shipped in 0.2.0-0.4.0
- Move from polling to real push infrastructure (WebSockets or
  similar) for messaging and live updates — this unlocks genuinely
  live guild chat, trade negotiation, and (later) real-time PVP if you
  want it eventually
- Not yet scoped in detail — deliberately left for its own planning
  pass once everything ahead of it exists to balance against

---

## 0.6.0 — TestFlight Migration

- Native wrapper needed (this is currently a web app; TestFlight
  requires a native build, not a direct upload)
- Apple Developer Program membership ($99/year)
- Admin tooling properly gated for external testers (not the current
  shared-code prompt)
- Player saves already migration-safe by design (server-side in
  Upstash, not browser-local)

---

## QOL — Ongoing, numbered 0.0.x

Not tied to a major version — built whenever there's a natural batch.

### Confirmed built (this session)
- Escape from capture (spawn permanently removed, no re-engagement)
- Battle turn-indicator badges (blue = you, yellow = other players,
  red = Titan)
- Pad RAM missing popup (clear error instead of silent failure)
- Trading: farming droids now correctly excluded from the trade list
  (this was a real bug, not just a missing feature)
- Hide-from-trade toggle per droid
- Player badge display — structural groundwork only (field + display
  slot exists), genuinely blocked on Achievements shipping since
  that's where badges come from

### Still outstanding
- HP/Attack/Special-attack icons — filenames confirmed
  (`assets/battle/hp.png`, `attack.png`, `special.png`), wired into
  battle HP displays; Attack/Special icon usage in the UI still to be
  expanded once those stats are more visually prominent in battle
- Materials audit — grouping materials by purpose in the Inventory UI,
  showing non-purchasable materials in the Shop as clearly marked
  "not purchasable," and a generic PNG-if-present-else-fallback-icon
  system for materials generally (droids/outfits already have this,
  materials don't yet)

---

## Open questions summary (everything I need a decision on)

1. **Achievements** — which version, or its own?
2. **0.2.0 cosmetic item count** — how many distinct items per slot per
   rarity?
3. **0.2.0 Depotus Prime / Ovumen Arcanjx** — any refinements to the
   two confirmed buffs, or interest in exploring debuff-style Galactic
   abilities?
4. **0.3.0 breed cost** — reconfirm 80,000✦ once 0.2.0's economy is
   finalized
5. **0.3.0 breed odds** — flat curve, or does the input pair matter?

---

Nothing in 0.2.0 has started yet. Once the open questions above are
answered (or you're happy for me to proceed with reasonable defaults
where marked), I'll begin the Depot/Galactic build first, since it's
the most fully-specified piece of the 0.2.0 bundle.
