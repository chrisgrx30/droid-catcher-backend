# What's New — v0.2.0

## Radar Sweep: two bands

Droids now have to be within **15 metres** to open the capture minigame.
Anything from 15m out to the edge of your sweep still shows on the map,
but greyed out with a "move closer" note instead of a capture track. A
cyan ring on the map shows your capture zone.

**Bug fixed along the way:** the terminal was sending the droid's own
coordinates as your position when resolving a capture, so the server's
distance check was comparing the droid to itself and always passing. It
has never actually been enforced until now.

## Manual Coordinates (admin)

New panel at the top of the Admin tab. Enter a latitude and longitude, or
tap one of six preset regions (London, New York, Tokyo, Sydney, Los
Angeles, Dubai), and every scan uses that position instead of your real
GPS. Survives a page reload. A red banner appears on the Capture tab
whenever it's active so a forgotten override can't be mistaken for real
results.

Because spawn timing is derived from longitude, jumping region also
jumps local time — so this is how you test Football, Void Zombie and
Lumen Sentinel windows without waiting for the clock.

## The Apex set — 30 new droids

A new rarity tier above Galactic, themed red throughout.

- **2200 HP / 140 attack** base, the highest in the game
- **2% capture rate** — the lowest in the game
- **4% minigame zone** — half the width of Cosmic, the hardest target
- **25 crystals** per attempt, sitting between Rare and Legendary

Apex droids **never spawn normally**. The only way one appears is an
active Apex Hunt.

## Apex Hunt

A 30-minute event, launched from the Admin tab, with a 6-hour cooldown.
While it runs, up to 3 Apex droids can exist worldwide at a time. Their
map markers are red and oversized — you'll know one when you see it.

## Apex Cubes

A separate currency that only Apex droids use. Drops 1-5 at a time and
**always drops something**, from three routes: capturing one (whether the
attempt succeeds *or* fails), defeating one in battle, and releasing one.

Apex droids level on cubes alone — crystals won't touch them, so no
amount of banked crystals fast-tracks the endgame set. Level 2 costs 10
cubes, level 3 costs 30, level 10 costs 398.

## Apex Encounters

A new battle type, separate from Titan encounters. 20,000 HP, 1,100
attack, 2,500 crystals to enter, 3-hour cooldown, up to 6 players.

**Solo is not recommended and you will lose.** This is tested, not
guessed: one player with the strongest possible team dies on turn 33.
Two players win narrowly, four win comfortably. Every survivor gets a
full reward and a cube roll.

## Token currencies

Titan Tokens, Guild Tokens and Joy Coins are now in the game and stocked
in the shop at 1,000,000 crystals each — deliberately the most expensive
items available, as a crystal sink.

They currently have no spend route. That's the joystick feature, which is
next.

## Smaller fixes

- Five Apex droids have hyphens in their names but not in their filenames
  (Verdant-01, Specter-7, Corsair-X, Assembler-X, Tidal-X). The terminal
  now tries both forms, so existing hyphenated art (Quasar-X, Recycl-8,
  Aurora-X, Frostbyte-X) keeps working too.
- The `galactic` rarity was missing from four of the five rarity lookup
  tables, which made its capture cost come out as `NaN`. Never triggered
  in play because Scaffitan Eternal is evolution-only, but it's fixed.
- New `assets/apex/` folder and route for Apex background art.

## Not in this release

- The joystick / Pulse system (tokens exist but can't be spent yet)
- Titan and Guild Token drop routes — shop is currently the only source
