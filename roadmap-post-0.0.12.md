# Sparkfield — Roadmap: Everything Discussed, Not Yet Built

Pulled from every planning conversation to date. Organized by priority
for "what opens the game up most," not by when it was discussed.

---

## My recommendation, and why it agrees with yours

**Battle infrastructure first — and I'd go further: build it as PVP
from the start, not PVE-then-PVP.**

The reasoning: almost everything else on this list is *downstream* of
Battles existing at all —

- **Mastery's whole payoff** (the special stun attack) has nowhere to
  live without a turn structure.
- **Gym/Hotspot control** — you've already said you want this shipped
  *together* with Battles, not after.
- **Achievements** — several of your table's entries are explicitly
  Titan/battle-defeat badges.
- **Galactic Depot droids** — the Factory/Depot-boost abilities are
  self-contained, but the broader "end-game power fantasy" framing
  leans on there being a battle to use that power in.
- **Buff items** (Mod Chips, USB Dongles, Glass Bottles) — you've
  already started designing these as battle consumables.

Building PVE first and PVP later means designing the turn/combat
system twice. Building **one turn-based combat engine that works for
both** — async, poll-based, same pattern already proven by trades and
guild invites — means Titans and player battles are two *content*
types on the same *engine*, not two separate systems. That's a
meaningfully smaller total build than sequencing them, and it directly
answers your #1 priority.

---

## Tier 1 — Build next (the real unlock)

**Battle Engine (PVE + PVP together, async turn-based)**
- Core turn resolution, shared by both Titans and player-vs-player
- Team composition (4 droids), HP/faint mechanics
- Async "attack, opponent responds later" model — confirmed as the
  only realistic option without new real-time infrastructure
- Titan encounters: group-capable, invite via Player ID (in-game,
  async — confirmed, not SMS-coordinated)
- Repair Kits (droid revival, tied directly to fainting)
- Entry fee, cooldown, reward structure (1 Repair Kit + 1 Beacon + 5
  Paint + 5 Nova Chips per confirmed Titan spec)

**Once the engine exists, these become quick follow-ons, not new builds:**
- Mastery's special attack (turn-based stun/cooldown translation)
- The Enforcer's damage buff actually doing something
- Titan-defeat achievement badges

---

## Tier 2 — Natural next builds once Battles exist

**Achievements System**
- Your table is the spec once you share it — placeholders noted as
  expected and fine to tweak later
- A-number Dex-style view, greyed→bronze→silver→gold progression
- Badge PNG/GIF per achievement (`Axxx` naming, `assets/achievements/`)
- Buffs active on Gold, guild leaderboard integration

**Hotspot/Gym Control**
- Confirmed: ship together with Battles, not separately
- New mechanic class — location *ownership* over real time, nothing
  currently in the architecture does this
- Hourly-hold rewards, defend-based Repair Kit ties-in

**Galactic Depot Overhaul**
- Full spec already confirmed: 10,000✦ Depot, 2 launch Galactics
  (Warehouse/Depot droid, Egg Caretaker/Hatchery droid), pity system
  (5-10/12-18/30 visits), account-bound Fragments, reward hierarchy
  (Paint→Nova Chips→Plug-in/Pad RAM→Evolution Stone)
- One open item before numbers get locked: confirm whether "Plug-in,
  Threads, Pad RAM" in the reward table are renamed existing materials
  or new ones — flagged, not yet resolved
- Easter egg noted: ultra-rare "nothing" result gets a joke popup
  ("You have been hacked and lost everything, goodbye")

**Breeding / Duplicator**
- Confirmed: any two droids can be used, output is 1-of-10 exclusive
  bred droids, both input droids are lost permanently regardless of
  outcome, failed-breed probability included so players keep trying
- 80,000✦ heavy crystal sink, confirmed direction
- Still needed: the actual probability-scoring mechanism, and your
  exclusive breeding droid roster once designed

---

## Tier 3 — Independent, can slot in anytime

**Crystal economy rebalancing** — a proper numbers pass across
farming rates, not just the capture-cost tweak already shipped;
your instinct that not everything should be per-minute is a good
starting point

**Nicknames** for owned droids — small, contained

**Evolve-on-trade** mechanic — contained once the trigger condition
and eligible species are decided (you said you'd think through the
"how" now that you know it's possible)

**Theme picker** — light/dark/blue/pink/green, CSS variable swap, no
real complexity

**Already-claimed spawn popup + removal from screen** — small, was
deferred from an earlier list, still outstanding

**Companion tab "liven up" brainstorm** — you flagged this as trivial
once Battles exist, since it's mostly about showing buff state
prominently

**Difficulty consistency tightening on the live map** — the 100m
density fix currently lands in your 5-10 target range about 75% of
the time; biasing point placement toward the scan center instead of
uniform-within-cell would tighten this further, purely optional polish

---

## Tier 4 — Infrastructure, not gameplay (do alongside, not instead of)

**TestFlight migration**
- Real gap already flagged: this is a web app, TestFlight needs a
  native wrapper (WebView or Capacitor-style shell), not a direct
  upload
- Apple Developer Program membership required ($99/year)
- Admin tab needs real gating (account-based, not a shared typed code)
  before it goes anywhere near external testers
- Good news already confirmed: saves live server-side in Upstash, so
  migration is safe by design — nothing extra needed there

**Real-time infrastructure (WebSockets or similar)**
- Not required for the Battle Engine above (async is the realistic
  choice) — but worth knowing this is the actual prerequisite if you
  ever want truly live PVP, live guild chat, or live trade
  negotiation later
- A genuine platform-level addition, not a per-feature one

---

## Waiting on you before I can build

- **Full Achievements table** — you said it's done, just needs sharing
- **Exclusive breeding droid roster** — you're designing these
- **Galactic droid names/final numbers** — you're pulling this together
- **Plug-in/Threads/Pad RAM naming clarification** for the Depot reward
  table
- **Home page assets** (logo.png, icon.png, posters) — code's ready,
  waiting on files

---

Nothing in Tier 1 has been started. Say the word and I'll begin
scoping the Battle Engine in detail — team composition rules, the
actual turn-resolution formula, and the async invite/response flow —
before any code gets written.
