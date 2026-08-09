# Sparkfield — What's New in 0.1.4 & 0.1.5

## Balance
- Enforcer spawn weight and capture rate both reduced further (0.05
  weight, 1.5% capture) after confirming the numbers weren't the issue
  — reducing them anyway to see if it changes the felt experience.
- Titan HP doubled again (1200 → 2400) — verified even a perfect
  Galactic-tier solo team now sits at an exact average tie, meaning
  real variance decides the fight rather than a guaranteed win.
- Common/Uncommon capture sweet-spot tightened a second time.
- Energy Tubes rebalanced: win grants 2-4 (was 4-7), loss grants 0
  (previously granted a small consolation amount).
- Fainted droids can no longer be leveled up or released — must be
  healed with a Repair Kit first (this wasn't actually enforced
  before, despite being the intended rule).
- Battle teams can no longer include duplicate species — variants
  don't count as different.

## Wardrobe — new system
- Full Head/Body/Arms/Legs wardrobe with rarity-grouped browsing, like
  the Warehouse. Beta Crown is the first real equippable item (Head,
  Legendary). Body/Arms/Legs are ready for future items.

## Friends — new feature
- Add by Player ID, accept/decline requests, see a friend's name and
  Dex progress.

## Shop
- Multi-item basket: add several different materials with their own
  quantities, then buy them all in one click, all-or-nothing (if you
  can't afford the whole basket, nothing is deducted).
- Buy buttons simplified to price only.

## Trading
- Any in-game material can now be offered or requested, not just
  droids and crystals — dropdown selection with quantity, a running
  list of what's in the offer on both sides, and a clear popup if
  either side can't cover what's being asked.
- Droids are now optional in a trade — a materials-only or
  crystals-only offer is valid.

## Real bugs fixed
- Evolution and Scaffitan mastery were completely silent on both
  success and failure — now show the new droid's icon on success, or
  a clear reason on failure.
- Crystal/min rate always showed 0 for any droid not currently
  farming (technically correct, practically useless) — now shows what
  it *would* earn if assigned, clearly labeled.
- A stale battle-log message still claimed consolation Tubes were
  granted on a group loss, after that reward was removed.
- Battle team preview had visibly uneven gaps — traced to columns
  having no fixed width, so longer species names pushed neighbors
  apart.

## Everywhere
- Header replaced with your logo, version moved below the connection
  status, and the "same as this page" server-URL box hidden.
- Admin access now requires the PIN upfront — the admin page simply
  doesn't render until it's correct, rather than showing first and
  prompting per action.
- Admin player list now shows guild name (not just ID) next to each
  player, and last-online turns red past 7 days.
- Warehouse: Repair button only shows on fainted droids, recolored
  yellow so it doesn't clash with Release. Auto-release and Clean Up
  moved into their own box below the droid list.
- Scaffitan's own icon now appears in battle, not just its name.

---

*Confirmed correct, not bugs: Home poster dismissal already persists
correctly across sessions (server-side), and like/dislike reactions
are already both visible to other players and mutually exclusive
(switching replaces, never stacks) — verified directly rather than
assumed.*
