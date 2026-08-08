# Sparkfield — What's New in 0.1.1

A focused polish pass following 0.1.0 testing — real bugs fixed, and a
long list of QOL requested from live play.

---

## Real bugs fixed (not just polish)

- **Guilds** — creating or joining a guild while already on the Guilds
  tab left it showing stale "not in a guild" state. Root cause: the
  tab had no refresh hook when clicked at all (unlike Battles and
  Override, which do). Fixed at the source.
- **Auto-release-duplicates "not working"** — the toggle itself was
  always fine; it just only ever prevented *new* duplicates from
  piling up, never reached back into an already-full Warehouse. Added
  a one-time "Clean Up Existing Duplicates Now" button that does
  exactly that, using the same rules as the live toggle.
- **Titan capture was silent** — originally built as an invisible 8%
  background roll. Now a real, interactive capture attempt using the
  same minigame as Depot/Factory, at genuinely hard odds (also found
  and fixed: Scaffitan's capture rate was mistakenly set to 100%
  instead of a hard rate — now 3%, below even Legendary's 5%).
- **Summer Event "not spawning"** — the spawn math was actually fine
  (confirmed at scale: ~22% of spawns were Solar species once properly
  active). The real issue was a silent failure in the admin "Start
  Summer Event" button — any failure (most likely a mistyped admin
  code) gave zero feedback. Now shows a clear success or failure
  popup.
- Several other silent failures fixed the same way: capture cooldown,
  insufficient crystals, redeem code failures, and pad upgrades
  missing Pad RAM all now show a clear popup instead of vanishing
  with no explanation.
- Trading: farming droids were never actually excluded from the trade
  list, despite being unavailable to trade — fixed.

## Titan Battles

- Escape from capture — a Run button on spawn cards, permanently
  removes that spawn, no re-engagement.
- Battle turn-indicator badges: blue = you, yellow = other players,
  red = Titan, with a glow on whoever's turn it is.
- Battle team picker rebuilt: grouped by rarity like the Warehouse,
  circle badges (fill = rarity, border = variant), a genuinely
  separate "Choose Your Battle Team" panel, and a live preview strip
  of your selected team above the Titan Encounter panel.
- An End button on finished battles so the panel doesn't sit there
  indefinitely.
- HP icon wired in (custom PNG with emoji fallback) — Attack/Special
  coming as those stats get more prominent in the UI.

## Shop

- Bulk buying: quantity +/- on materials, a confirmation screen
  showing the total before you commit.
- Repair Kit price corrected to 1000✦.

## Home

- Poster like/dislike reactions, and a Close button that dismisses a
  poster for good (per-player, not just hidden from everyone).

## Map

- Spawn markers now carry three independent signals: fill = alignment
  (existing), border color = variant (Rusty/Platinum/Funky), size =
  rarity.

## Admin

- Moved off the main nav entirely — now a small, low-visibility link
  at the bottom of the Home tab.
- Admin PIN reset for accounts that can't self-serve a reset.

## Everywhere

- Active/Attack buttons are now genuinely green when they mean "go."
- Capture and hatch results show a droid PNG with a rarity-colored
  border, and capture results now show which buffs (e.g. Nebulfox)
  actually contributed to the odds.
- Companion tab wording simplified.

---

*Still on the roadmap: the Shop's category-click-to-browse layout, and
everything scoped for 0.2.0 onward (Depot/Galactic, Cosmetics,
Attachments, Underground Store).*
