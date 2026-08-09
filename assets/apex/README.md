# Apex Set Artwork

Backgrounds and theming art for the Apex tier. Served at
`/assets/apex/<filename>` — same rules as every other asset folder.

**Filenames:** lowercase, letters/numbers/underscore/hyphen only, then
`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` or `.svg`. Anything else is
rejected by the route with a 400.

## Files the terminal looks for

These are optional — every panel falls back to its plain dark background
if the file isn't here, so you can add art gradually.

- `apexhunt.png` — background for the Apex Hunt admin panel
- `apexbattle.png` — background for the Apex battle box (battle system
  not built yet; the folder and route are ready for it)

## Droid art does NOT go here

The 30 Apex droid images live in `assets/droids/` with every other
species, named after the species in lowercase — `voltrix.png`,
`chronobot.png`, and so on. They're already in place.

Note: five Apex species have hyphens in their names but no hyphen in
their filename (Verdant-01 -> `verdant01.png`, Specter-7 ->
`specter7.png`, Corsair-X -> `corsairx.png`, Assembler-X ->
`assemblerx.png`, Tidal-X -> `tidalx.png`). The terminal now tries both
forms, so either naming works from here on.
