# Droid Catcher — Expansion Roadmap v1

## 1. Droid Leveling (crystals → stronger droids)

Spend crystals to level up an individual droid. The level multiplier already
exists in the accrual formula (`+15% crystal rate per level` in `workshop.js`)
— what's missing is the *spend* mechanism.

- **Cost curve:** `cost(level) = 10 × level^1.6` (rounded) — cheap early,
  expensive late, so players feel early progress fast but late-game levels
  are a real crystal sink (keeps the economy from feeling solved).
- **Effect:** crystal production only, to start. Keep leveling's payoff
  simple and legible — "leveling makes this droid farm more" — before
  layering in a second effect.
- **Cap:** suggest level 20 as a soft cap for v1 (mirrors most idle games —
  gives a visible "maxed out" milestone worth chasing per droid).
- **New endpoint:** `POST /droids/:id/level-up`.

## 2. Pad Upgrades (crystals → better capture odds)

This is account-level progression, not per-droid — you're upgrading the
control pad itself, separate from the droid leveling above.

- **Critical Capture:** each pad level adds a small chance (start at 2%,
  +1%/level) that an attempt becomes a guaranteed success regardless of the
  computed `successChance` — a slot-machine-style "big win" moment that
  makes upgrading the pad feel exciting, not just incrementally better.
- **Alternative/additive effect:** raise the `padSkillMultiplier` ceiling
  (currently capped at 1.2x) by a small amount per pad level, so skilled
  play scales with progression too.
- **New endpoint:** `POST /players/:id/upgrade-pad`, new `player.padLevel`
  field, cost curve similar to droid leveling but shared across all
  captures (so it's a bigger, less frequent purchase).

## 3. Trading (player-to-player)

Structure as an offer/accept flow, not instant swap, so both sides
knowingly consent — this is also where most GO-likes get abused if you skip
the guardrails:

- **Flow:** Player A creates a trade offer (their droid(s)/crystals ↔
  requested droid(s)/crystals from Player B). Player B accepts or declines.
  Only on accept does the server atomically swap ownership.
- **New table:** `trade_offers` (fromPlayerId, toPlayerId, offered items,
  requested items, status).
- **Guardrails worth building in from day one** (retrofitting anti-cheat is
  much more painful than launching with it):
  - Cooldown before a freshly-captured droid is trade-eligible (prevents
    bot-account crystal/rarity laundering — a real problem Pokémon GO had
    to patch for).
  - Optional: a small crystal "trade fee" scaling with rarity, so trading
    isn't the strictly-optimal way to acquire legendaries over capturing.

## 4. What drives focus on capturing + farming (beyond what you listed)

Ranked roughly by implementation effort vs. retention payoff:

- **Daily/weekly quests** ("catch 3 Dark droids," "farm 500 crystals") —
  cheap to build, proven retention lever, gives players a reason to open
  the app even when nothing rare is nearby.
- **Time-exclusive events** (your idea) — generalize the day/night bias
  system we already built into a stackable "active modifiers" list rather
  than a single hardcoded rule. An event becomes: `{ speciesIds or
  collection, spawnWeightMultiplier, startTime, endTime }`. Very little new
  code since the spawn weighting logic already supports multipliers.
- **Collection/dex completion rewards** — bonus crystals or a cosmetic for
  catching every species in a set (e.g. all 4 Nature-collection droids) —
  gives long-tail purpose to common droids that are otherwise "done" after
  the first capture.
- **Egg/walking incubation** — walk X distance (via GPS delta between
  requests, which we already track) to hatch a guaranteed-rarity droid.
  Strong fit for a location-based game specifically — rewards the
  "go outside" behavior GO-likes depend on.
- **Leaderboards** — most crystals farmed, rarest catch, longest streak.
  Low build cost, high social-pressure payoff.
- **Guild/co-op "siege" spawns** — a Legendary that requires multiple
  players capturing/contributing simultaneously to bring down. Bigger
  build (needs real-time coordination), but a strong headline feature if
  you get there.
- **Cosmetic shop** — ties directly into your Rusty→Painted idea; once that
  system exists, a shop for polish/paint items is a natural crystal sink
  that doesn't affect competitive balance.

## Suggested build order

1. Droid leveling (small, uses infrastructure that already exists)
2. Pad upgrades / critical capture (small, same pattern as #1)
3. Time-exclusive events (medium — generalizes existing spawn bias code)
4. Trading (medium-large — needs the guardrails above)
5. Quests/leaderboards (medium, high retention value, can build anytime)
6. Rusty → Painted evolution + cosmetic shop (needs inventory system first)
7. Guild siege spawns (large — real-time/multiplayer coordination)
