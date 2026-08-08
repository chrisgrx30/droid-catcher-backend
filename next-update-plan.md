# Sparkfield — Next Update Plan (post-0.0.9)

No code written yet — this is the agreed scope and design, ready to build
from once confirmed.

---

## 0. Rename: Droid Catcher → Sparkfield

Touches everything cosmetic, no functional changes:
- Terminal header title, browser tab title
- `package.json` name field
- README title
- Any in-app copy that says "Droid Catcher"

Low-risk, do this first so every subsequent file/screenshot uses the
real name.

---

## 1. Shop (Inventory tab)

**Confirmed scope: every material except crystals goes in the shop** —
Paint, Nova Chips, Beacons, and any future material (the new
Depot-earned HP/Attack material, eventually Repair Kits) — built as an
extensible catalog, not a fixed set of buttons, so new materials slot
in later without rework. Beta Crown purchase moves here too, out of
the Player tab.

**Pricing — confirmed approach, numbers delegated to me:** deliberately
heavy. The point is that buying your way past the grind should cost
noticeably more than earning the same material through normal play —
a real reward for players who can farm large crystal amounts, not a
cheap shortcut. I'll propose specific numbers at build time.

---

## 2. Companion: The Enforcer

Third companion buff type: `damage` (+100%). Like Nebulfox, this needs
an **Activate** button — 1 hour active window, cooldown after
(reusing the same per-droid timer pattern already built for Nebulfox).
No effect until the Battle system exists to consume "damage" as a real
stat, but the companion and its activation mechanic can be built now.

---

## 3. Buddy / Mastery System — DEFERRED to next round, alongside Battles

Mastery's max-level special attack is a battle mechanic, so this waits
until Battles' turn structure is designed — building it first would
mean designing blind. See section 8.

A maxed-level droid can be assigned as your **Buddy** (Player tab) —
can't farm while a Buddy, gains a **Mastery Level** once per day, up to
a 30-day cap.

**Confirmed effects, scaling with Mastery Level:**
- Crystal gain increases
- HP increases
- Attack increases
- **At max Mastery (day 30):** unlocks a second, special attack — a
  **stun** effect (opponent stunned 5 seconds), with its own **20
  second cooldown** separate from normal attacks.

**Design implication worth flagging:** a literal 5-second stun and
20-second cooldown implies something closer to real-time combat pacing.
Since this app has no live/real-time infrastructure anywhere (guild
chat and everything else works by polling on tab-visit), I'd recommend
translating this into **turn-based equivalents** rather than building
real wall-clock timing into Battles: e.g. stun = "opponent skips their
next turn," 20-second cooldown = "usable once every N turns." Keeps the
whole game on one consistent architecture. Flagging this now since it
affects how Battles get designed — confirm before that system is scoped
in detail.

---

## 4. Depot Rebalance: Augment Core

New material, named **Augment Core** — drops from Depot, spent on
customizing an individual droid's HP/Attack beyond normal leveling.
Also obtainable from PVE Battles once that system exists (deferred,
see below). Depot's current three-way odds (crystals guaranteed + flat
Paint/Nova Chip chance) need rebalancing to make room for this as a
fourth possible outcome without diluting the other two below a
meaningful rate.

*Open: exact odds and how much HP/Attack one Augment Core grants —
propose when we build.*

---

## 5. Outfits (Player tab → purchased from Shop)

**Confirmed:** 4 outfits, purchased from the new Shop (not the Player
tab directly), **5000✦ each**:
1. Earthy
2. Technology
3. Wildlife
4. Funky

A free **Basic** outfit is auto-equipped by default for every player —
nothing to buy or unlock for that one. Layout change on the Player tab:
move the ID/callsign block closer together, outfit selector/display
goes on the right. Art assets ready.

---

## 6. Anti-Spam Protection (real gap, confirmed)

Verified there's currently **no rate limiting at all** on the spawn
endpoint. Plan:
- Simple per-player request rate limit (reject scans that come in
  faster than some reasonable interval).
- A hard cap on total unclaimed spawns visible to one player at once,
  so rapid-fire scanning from slightly different coordinates can't
  build an unbounded queue.

---

## 7. Football-Themed Droid Roster (20 species — confirmed final)

| Name | Side | Rarity |
|---|---|---|
| Cannix | Dark | Legendary |
| Redforge | Dark | Legendary |
| Liverflare | Dark | Legendary |
| Regalion | Dark | Rare |
| Hammerclad | Dark | Rare |
| Skytalon | Dark | Rare |
| Ironfang | Dark | Uncommon |
| Rootcore | Dark | Uncommon |
| Emberhart | Dark | Uncommon |
| Cherrybyte | Dark | Common |
| Spurwing | Light | Legendary |
| Skymane | Light | Legendary |
| Lionvolt | Light | Rare |
| Magpiex | Light | Rare |
| Towerguard | Light | Rare |
| Gullstrike | Light | Uncommon |
| Rivershield | Light | Uncommon |
| Hexasting | Light | Uncommon |
| Scarforge | Light | Common |
| Plumebolt | Light | Common |

No evolutions on this set (confirmed) — standalone, club-themed.
Evolutions come back into focus once Nova Chip acquisition has more
sources (Augment Core / Depot rebalance above is a step toward that).

**Note on tier distribution:** unlike every prior collection (always
exactly 2 species per rarity per side), this one is uneven — Common 3,
Uncommon 6, Rare 6, Legendary 5. The per-tier weight split (below)
accounts for this directly rather than assuming an even split.

**Spawn rule:**
- Light side: only spawns 3pm-5pm
- Dark side: only spawns 8pm-10pm
- **Both only on Saturday and Sunday**
- Lives in the **main Dex** (unlike Solar, which is event-exclusive and
  lives in a separate Event Dex)

**Design intent — confirmed:** stays in the **main Dex** deliberately.
Legendary and Cosmic tiers stay proportionally rare within this set,
same balance logic as every other collection, so this doesn't create a
lopsided "easy legendary" path. The whole point is to make the main
Dex harder to fully complete — a controlled long-tail difficulty
mechanism, directly addressing the "testers finishing the Dex too
fast" concern from a few rounds back. Not a time-limited event like
Solar — a permanent, recurring weekly pattern.

**Implementation approach:** reusing the Solar collection's "grant"
pattern (real weight added only while active) rather than the
always-on shared pool every other collection draws from — but
computed automatically from local time + day-of-week rather than
admin-triggered. This means it's purely additive during the window and
**never dilutes any other collection's spawn odds** the rest of the
time, the same non-destructive property that made Solar safe to add.
Within the window, each rarity tier's usual total (60/25/12/3) splits
across however many football species share that tier (e.g. Legendary:
3/60 = 0.6 each), so the uneven per-tier counts above are accounted
for directly. Local-time check reuses the existing longitude-based
estimation already used for day/night alignment bias, so the window
lands sensibly regardless of a player's actual timezone.

---

## 8. PVE: Titan Battles — DEFERRED to next round

Confirmed: parked until this batch (sections 0-7, 9-10) lands and is
stable. Repair Kits are tied to this too (a fainted droid only exists
once Battles exist), so those are deferred as well. Design notes below
kept for when we pick this back up.
**Invites — confirmed, staying in-game.** Given this app has no
real-time push anywhere (guild chat, trades, everything works by
polling on tab-visit), I'd build this the same way: the initiator
starts a Titan encounter and invites specific Player IDs; invited
players see it as a **pending invite** next time they open the Battles
tab, not an instant popup. Functionally similar to how trade offers
already work — proposed, then accepted/declined async. Worth setting
that expectation clearly: it's "in-game," just not live-synchronous.

**Confirmed structure:**
- New **Battles** tab
- Player scans → a Titan may spawn (rarity/frequency TBD)
- 1000 crystal entry fee
- 2-hour cooldown per Titan
- **Group mode:** guild members battle together against one Titan
- **Solo mode** (if no group): a team of 4 of your own droids
- Droids can **faint** ("breakdown") during battle
- **Reward on defeat:** 1 Repair Kit, 1 Beacon, 5 Paint, 5 Nova Chips
- Titan art assets ready to add

**Repair Kits (item 4, tied to this):** consumable that revives/repairs
a fainted droid, presumably usable outside of battle too (Storage tab?)
so a fainted droid isn't permanently stuck.

**Still genuinely undefined — this is the core of the feature and
deserves its own focused pass, not folded into this list:**
- The actual damage formula (how HP/Attack, level, and variant combine
  into a hit)
- Turn structure — I'd recommend simple round-based resolution (each
  side's team acts in sequence, repeat until one side's team is fully
  fainted), consistent with the turn-based recommendation for Mastery's
  special attack above
- How a *group* of guild members' individual droid teams combine
  against one Titan (turn order across multiple players, shared HP
  pool for the Titan, etc.)
- Titan spawn rarity/frequency and stat scaling
- What happens to entry-fee crystals if the group loses

**Recommendation:** treat this as its own design session once the rest
of this list is built and stable, rather than trying to fully spec
combat math in this planning pass.

---

## 9. Image/Visual Additions

All straightforward asset-drop-in work, same pattern as existing droid
art (no new plumbing needed for most of these):
- **Egg PNG** (Factory) — ready to add
- **Control Pad background image** — sits behind the LOCK-ON minigame text
- **Spawn card background** — varies by alignment (Light/Dark/Cosmic)
- **Variant image shading** — CSS tint/overlay as a fallback when no
  dedicated Rusty/Platinum image file exists for a species (the
  dedicated-file system already works today; this adds a cheaper
  fallback so you don't need 3x the art per species)
- **Farm "droid working" animation** — a generic GIF/animation in
  Workshop slot cards, not tied to any one species (note: animated GIFs
  for a *specific* species' own image already work today, since `.gif`
  was already in the supported list — this is a separate, generic
  addition)

---

## 10. Small Process/UI Items

- **User Guide linked from Player tab** — needs a decision: serve the
  guide as a static file from the server (like droid images), or link
  to wherever it ends up hosted once pushed to GitHub.
- **Zip filenames include the version number** going forward (e.g.
  `sparkfield-v0.0.10.zip`) — process change on my end, no code.

---

## Suggested Build Order

Roughly grouped by size/risk, not necessarily the order to tackle them:

**Small, contained, safe to batch together:**
Rename to Sparkfield · Shop + Beta Crown relocation · Anti-spam
protection · Image/visual additions · Guide link · Versioned zip names

**Medium, needs a few numbers decided at build time:**
Enforcer + activation · Depot rebalance · Outfits (once you confirm
layout details) · Football roster (once the list is finalized and the
timezone/main-Dex question is answered)

**Large, deserves its own design pass before coding starts:**
Buddy/Mastery system (turn-based translation of the stun mechanic) ·
PVE Titan Battles (damage formula, turn structure, group combat) —
these two are linked, since Mastery's special attack is a *battle*
mechanic, so Battles' turn structure should probably be nailed down
first, then Mastery's special attack designed to fit it.

---

Nothing built yet. Confirm scope/order and I'll start.
