# Sparkfield — What's New in 0.1.6

## Zombie & Lumen lines — 5th tier
Both lines now go one step further: **Voidsovereign** (Zombie) and
**Luminarch** (Lumen), a new Cosmic-rarity cap. Getting there needs a
new material — Zombie Juice / Lume Cells — rare drops (3%) from
capturing Shambler/Illume, or from releasing any tier of either line.
Full current cost table (all four evolution steps, both lines) is in
`TUNING-GUIDE.md`.

## New player-facing systems
- **Buff Summary** — a real box showing every buff currently affecting
  you (Crystal Gain, Capture Rate, Attack), plus honestly-labeled
  placeholders for HP/Cosmetics/Attachments, which don't do anything
  yet even though the Wardrobe UI exists.
- **Offline Crystal Rate** — shows your hourly rate and 4-hour max
  before you go offline. Offline earning itself now caps at 4 hours
  (down from 10) at 30% of normal rate.
- **Color Themes** — Day, Pink, Sky Blue, Dark Green, alongside the
  original dark theme. Persists across sessions. Rarity colors stay
  constant across every theme since they carry real gameplay meaning.
- **8 Funky paint colors** (up from 3): Red, Orange, Yellow, Green,
  Cyan, Blue, Purple, Pink — all using the existing shared tint
  system, no new artwork needed.

## Everywhere
- Collapsed-by-default droid lists in Battles, Shop, and Warehouse —
  tap a rarity to reveal it, not shown by default.
- Funky's color scheme fixed — it visually collided with Rusty
  before. Now a genuine animated rainbow with a sparkle effect.
- Battle team list rebuilt: rarity circle simplified, droid info wraps
  to 2 lines, variant indicator moved to the right where it belongs.
- Warehouse row layout rebuilt to the requested structure — rarity
  above the icon, Level Up stacked above Release, reordered droid
  details.
- Evolution and Scaffitan mastery now show a real result popup either
  way, instead of being silent.
- Processor slots show an egg icon when filled, a placeholder when
  empty.
- The capture minigame's alignment background now genuinely supports
  PNG *or* GIF — it only worked with PNG before, despite looking like
  it might support both.

---

*Two real code mistakes caught and fixed mid-build this round before
they shipped: a variable-scoping bug that would have made a capture
drop always report as missing, and two spots where a new function was
built but never actually exported, causing an immediate crash the
moment it was called.*
