// battle.js
//
// Core turn-based battle engine. Built for PVP first, per confirmed
// priority — PVE Titans will reuse this same engine as a second
// content type (a computer-controlled opponent) once that's scoped,
// not a separate system.
//
// Design decisions, confirmed before building:
// - Strict ALTERNATING turns (not simultaneous submission) — matches
//   the async "attack, opponent refreshes and responds" model already
//   described and validated.
// - ROTATING 1v1 team model (not 4-vs-4 simultaneous) — one active
//   droid per side from a team of 4, next non-fainted droid auto-swaps
//   in when the active one faints.
// - No Defense stat exists on droids yet — damage is Attack-based only,
//   with a small random variance. Flagged plainly rather than quietly
//   inventing a new stat.
// - Fainted droids stay fainted after the battle ends, healed only via
//   a Repair Kit from the Warehouse (not built yet).

const db = require('./db.js');
const workshop = require('./workshop.js');
const captureModule = require('./capture.js');
const memory = require('./memory.js');

// PLACEHOLDER Titan — no real Titan design/stats were ever provided
// (only "I have a good rarity Titan, will confirm the name later" was
// mentioned). This is a stand-in so the solo-battle infrastructure is
// provable now. Swap the name/stats here once the real one is ready —
// nothing else needs to change.
// The Titan encountered in battle — Scaffitan. Fight stats are fixed
// encounter numbers (not simply the Common-tier species' own base
// stats, which would be far too weak for a "boss" fight); a successful
// post-win capture roll grants the actual capturable Common-tier
// Scaffitan species instead.
// ---- Titan roster ----
// Scaffitan is the regular encounter; Luminarch and Voidlord are the
// surprises. Weights are time-of-day dependent — Luminarch favours
// daylight, Voidlord the night — using the same longitude-derived local
// hour that drives spawn windows, so it stays consistent with the rest
// of the game rather than inventing a second clock.
//
// Scaffitan keeps a flat weight so it stays the one you usually meet
// whatever the hour.
const TITAN_ROSTER = [
  {
    name: 'Scaffitan', hp: 2400, attack: 35,
    weightDay: 70, weightNight: 70,
    drops: null,
  },
  {
    name: 'Luminarch', hp: 3200, attack: 48,
    weightDay: 25, weightNight: 5,
    // Lume Cells feed the Lumen Sentinel evolution line.
    drops: { material: 'lumeCells', min: 3, max: 8 },
  },
  {
    name: 'Voidlord', hp: 3200, attack: 48,
    weightDay: 5, weightNight: 25,
    // Zombie Juice feeds the Void Zombie evolution line.
    drops: { material: 'zombieJuice', min: 3, max: 8 },
  },
];

// Titan Tokens: a low chance on any Titan defeat.
const TITAN_TOKEN_DROP_CHANCE = 0.08;
// Guild Tokens: awarded when you beat a Titan or Apex alongside at
// least one guild member. Encourages guild play rather than pure luck,
// so this is a certainty rather than a roll.
const GUILD_TOKEN_PER_WIN = 1;

function pickTitan(lng) {
  // Reuse the game's existing day/night logic rather than a second one.
  let isDay;
  if (Number.isFinite(lng)) {
    try { isDay = require('./spawns').isDaytime(lng); } catch (e) { isDay = undefined; }
  }
  if (isDay === undefined) {
    // No player longitude to hand (Titans are started from a menu, not
    // from a map position), so fall back to server UTC.
    const h = new Date().getUTCHours();
    isDay = h >= 6 && h < 18;
  }
  const key = isDay ? 'weightDay' : 'weightNight';
  const total = TITAN_ROSTER.reduce((a, t) => a + t[key], 0);
  let roll = Math.random() * total;
  for (const titan of TITAN_ROSTER) {
    roll -= titan[key];
    if (roll <= 0) return titan;
  }
  return TITAN_ROSTER[0];
}

// Awards the Titan-specific extras on a win: the roster drop (Lume
// Cells / Zombie Juice), a low-chance Titan Token, and a Guild Token if
// a guildmate fought alongside you.
//
// `allWinnerIds` is the full winning side, so guild detection works for
// group encounters. Solo wins can never earn a Guild Token, which is
// the intent — it's a reward for playing together.
function awardTitanExtras(player, titanDef, allWinnerIds) {
  const out = { material: null, materialAmount: 0, titanToken: 0, guildToken: 0 };
  if (!player) return out;

  if (titanDef && titanDef.drops) {
    const d = titanDef.drops;
    const amount = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
    player[d.material] = (player[d.material] || 0) + amount;
    out.material = d.material;
    out.materialAmount = amount;
  }

  if (Math.random() < TITAN_TOKEN_DROP_CHANCE) {
    player.titanTokens = (player.titanTokens || 0) + 1;
    out.titanToken = 1;
  }

  if (player.guildId && Array.isArray(allWinnerIds)) {
    const withGuildmate = allWinnerIds.some((id) => {
      if (id === player.id) return false;
      const other = db.players.get(id);
      return other && other.guildId && other.guildId === player.guildId;
    });
    if (withGuildmate) {
      player.guildTokens = (player.guildTokens || 0) + GUILD_TOKEN_PER_WIN;
      out.guildToken = GUILD_TOKEN_PER_WIN;
    }
  }
  return out;
}

// "Rare" per confirmed design, exact rate not specified — flagged as my
// own placeholder number, easy to retune once you've seen it in play.
const SCAFFITAN_CAPTURE_CHANCE = 0.08;
const TITAN_ENTRY_FEE = 1000;
// Titan cooldown removed on request — the entry fee is now the only
// limiter. Left as a constant at 0 rather than deleted so the guard
// code stays intact and it can be reinstated with one number.
const TITAN_COOLDOWN_MS = 0;
const TITAN_REWARDS = { repairKits: 1, beacons: 1, paint: 5, novaChips: 5 }; // confirmed spec

// No PVP-specific reward was ever specified — only the Titan battle
// reward (1 Repair Kit + 1 Beacon + 5 Paint + 5 Nova Chips) was
// confirmed, and that's explicitly a PVE reward. This is my own
// reasonable default for a PVP win, not a confirmed spec — flagged
// plainly so it's easy to correct.
const PVP_WIN_CRYSTAL_REWARD = 200;

const DAMAGE_VARIANCE = 0.1; // +/-10% per hit, keeps outcomes from feeling too deterministic

// ---- APEX ENCOUNTERS ----
// A separate encounter type from the Titan, not a variant of it: its own
// entry fee, cooldown, roster and rewards, so tuning one never disturbs
// the other.
//
// APEX_BATTLE_HP / ATTACK are fixed ENCOUNTER numbers, not the species'
// own baseHP (2200) — same approach the Titan takes.
//
// These are tuned against a KEY property of this engine: turns rotate,
// so only ONE player attacks per turn regardless of party size. Extra
// players therefore do NOT increase damage output — they add team HP,
// which buys more turns before the raid wipes. That means the lever that
// makes an Apex a group fight is its ATTACK, not its HP.
//
// Measured against the strongest possible team (4x level-20 Apex, 8470
// HP / 539 attack each):
//   1 player  — survives ~30 turns, deals ~16,200  -> LOSES
//   2 players — survives ~61 turns, deals ~32,900  -> wins, narrowly
//   4 players — survives ~123 turns, deals ~66,300 -> comfortable win
// Real teams are weaker than that ceiling, so solo is hopeless in
// practice, which is the confirmed intent.
const APEX_BATTLE_HP = 20000;
const APEX_BATTLE_ATTACK = 1100;
const APEX_ENTRY_FEE = 2500;
const APEX_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours — longer than the Titan's 2h
const APEX_MAX_PARTICIPANTS = 6;
// Cube payout on defeating one. Held to the confirmed 1-5 range, same as
// capturing and releasing. See the note in the delivery summary about
// what this implies for how long an Apex takes to level.
const APEX_BATTLE_REWARDS = { repairKits: 2, beacons: 2, paint: 10, novaChips: 10 };

// ---- Special attacks ----
// Every droid charges a special by landing normal attacks. Effects and
// power scale with rarity, so a Common's special is a mild edge while a
// Legendary's swings a fight. Charge lives on the battle, not the droid,
// so it resets naturally between battles.
const SPECIAL_CHARGE_REQUIRED = 4; // normal attacks needed to charge

const SPECIAL_BY_RARITY = {
  common:    { name: 'Power Strike',   kind: 'damage', damageMult: 1.6, note: '1.6x damage' },
  uncommon:  { name: 'Rally',          kind: 'heal',   healPercent: 25, note: 'heals 25% max HP' },
  rare:      { name: 'Stunning Blow',  kind: 'stun',   damageMult: 1.4, stunTurns: 1, note: '1.4x damage, stuns 1 turn' },
  legendary: { name: 'Overload',       kind: 'damage', damageMult: 2.2, note: '2.2x damage' },
  cosmic:    { name: 'Force Switch',   kind: 'switch', damageMult: 1.5, note: '1.5x damage, forces opponent swap' },
  galactic:  { name: 'Nova Cascade',   kind: 'stun',   damageMult: 2.0, stunTurns: 2, note: '2x damage, stuns 2 turns' },
  apex:      { name: 'Annihilate',     kind: 'damage', damageMult: 3.0, note: '3x damage' },
};

function specialFor(rarity) {
  return SPECIAL_BY_RARITY[rarity] || SPECIAL_BY_RARITY.common;
}

// Charge is tracked per battle per droid id.
function chargeMapFor(battle) {
  if (!battle.specialCharge) battle.specialCharge = {};
  return battle.specialCharge;
}

function chargeOf(battle, droidId) {
  return chargeMapFor(battle)[droidId] || 0;
}

function addCharge(battle, droidId) {
  const m = chargeMapFor(battle);
  m[droidId] = Math.min(SPECIAL_CHARGE_REQUIRED, (m[droidId] || 0) + 1);
  return m[droidId];
}

function clearCharge(battle, droidId) {
  chargeMapFor(battle)[droidId] = 0;
}

function isSpecialReady(battle, droidId) {
  return chargeOf(battle, droidId) >= SPECIAL_CHARGE_REQUIRED;
}

// Resolves a special against a single boss entity (group Titan / Apex).
// Force-switch has no meaning against one opponent, so it falls back to
// its damage component; stun makes the boss skip its counter-attack.
function resolveBossSpecial(battle, attackerDroid, attackerEnriched, opts) {
  const special = specialFor(attackerEnriched.rarity);
  const wants = Boolean(opts && opts.useSpecial);
  if (!wants) {
    return { used: false, special, mult: 1, effect: null, charge: addCharge(battle, attackerDroid.id) };
  }
  if (!isSpecialReady(battle, attackerDroid.id)) {
    throw new Error(`${special.name} isn't charged yet (${chargeOf(battle, attackerDroid.id)}/${SPECIAL_CHARGE_REQUIRED})`);
  }
  clearCharge(battle, attackerDroid.id);

  let effect = null;
  let mult = special.damageMult || 0;

  if (special.kind === 'heal') {
    const healed = Math.round(attackerEnriched.hp * (special.healPercent / 100));
    attackerDroid.currentHpDamage = Math.max(0, (attackerDroid.currentHpDamage || 0) - healed);
    effect = { kind: 'heal', healed };
    mult = 0;
  } else if (special.kind === 'stun') {
    battle.bossStunTurns = (battle.bossStunTurns || 0) + special.stunTurns;
    effect = { kind: 'stun', turns: special.stunTurns };
  } else if (special.kind === 'switch') {
    // Nothing to switch to — the damage still lands.
    effect = { kind: 'switch', to: null, note: 'No effect against a single boss' };
  }

  return { used: true, special, mult, effect, charge: 0 };
}

function isFainted(droid) {
  return workshop.enrichDroid(droid).fainted;
}

function currentHp(droid) {
  return workshop.enrichDroid(droid).currentHp;
}

function validateTeam(playerId, droidIds) {
  if (!Array.isArray(droidIds) || droidIds.length !== 4) {
    throw new Error('A battle team must be exactly 4 droids');
  }
  const droids = droidIds.map((id) => {
    const droid = db.ownedDroids.get(id);
    if (!droid || droid.playerId !== playerId) throw new Error('Droid not found for player');
    // Garrisoned droids are defending a Fort and can't also be on an
    // attacking team.
    if (droid.fortId) throw new Error('One of those droids is garrisoned in a Fort — withdraw it first');
    if (droid.smugglerRun) throw new Error("One of those droids is out on a Smuggler's Run");
    return droid;
  });
  const faintedOnEntry = droids.filter(isFainted);
  if (faintedOnEntry.length === droids.length) {
    throw new Error('Every droid on this team is fainted — heal at least one with a Repair Kit first');
  }
  const speciesIds = droids.map((d) => d.speciesId);
  if (new Set(speciesIds).size !== speciesIds.length) {
    throw new Error('All 4 droids must be different species — variants of the same species don\'t count as different');
  }
  return droids;
}

function firstNonFaintedIndex(droids) {
  return droids.findIndex((d) => !isFainted(d));
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function attemptScaffitanCapture(battleId, playerId, padAccuracy, crystalsSpent) {
  const battle = db.battles.get(battleId);
  if (!battle) throw new Error('Battle not found');
  if (!battle.scaffitanCaptureAvailable) throw new Error('No Scaffitan capture attempt available on this battle');

  if (battle.isGroupTitanBattle) {
    if (!battle.winnerParticipantIds.includes(playerId)) throw new Error('You did not win this fight');
    if (battle.scaffitanCaptureUsedBy.includes(playerId)) throw new Error('You already attempted this capture');
  } else {
    if (battle.winnerId !== playerId) throw new Error('You did not win this fight');
    if (battle.scaffitanCaptureUsed) throw new Error('You already attempted this capture');
  }

  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (player.crystalBalance < crystalsSpent) throw new Error('Not enough crystals');
  player.crystalBalance -= crystalsSpent;
  if (crystalsSpent > 0) {
    db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -crystalsSpent, source: 'scaffitan_capture_attempt', createdAt: Date.now() });
  }

  const scaffitanSpecies = db.droidSpecies.find((s) => s.name === 'Scaffitan');
  let captureChance = scaffitanSpecies.baseCaptureRate
    * captureModule.crystalBonus(crystalsSpent)
    * captureModule.padSkillMultiplier(padAccuracy, player.padLevel);
  captureChance = Math.max(0.01, Math.min(0.5, captureChance)); // even a perfect attempt caps well below a normal capture — this is meant to be genuinely hard

  const success = Math.random() < captureChance;
  if (battle.isGroupTitanBattle) {
    battle.scaffitanCaptureUsedBy.push(playerId);
  } else {
    battle.scaffitanCaptureUsed = true;
  }

  if (!success) {
    return { success: false, captureChance, crystalBalance: player.crystalBalance };
  }
  const droid = grantScaffitan(playerId);
  return { success: true, captureChance, crystalBalance: player.crystalBalance, droid: workshop.enrichDroid(droid) };
}

function grantScaffitan(playerId) {
  // No auto-release exclusion check needed here or in capture.js: this
  // is the ONLY way a Scaffitan ever enters a player's inventory —
  // spawnWeight is 0 everywhere, so it can never pass through the
  // normal wild-spawn -> capture-attempt flow that auto-release
  // monitors. It's architecturally exempt, not exempt via a special case.
  const scaffitanSpecies = db.droidSpecies.find((s) => s.name === 'Scaffitan');
  const droid = {
    id: db.nextId(),
    playerId,
    speciesId: scaffitanSpecies.id,
    variant: 'standard',
    level: 1,
    captureCost: 0,
    capturedAt: Date.now(),
    workshopSlotId: null,
    currentHpDamage: 0,
  };
  db.ownedDroids.set(droid.id, droid);
  db.markDexSeen(playerId, scaffitanSpecies.id, 'standard');
  return droid;
}

function createChallenge(challengerId, opponentId, challengerTeamIds) {
  if (challengerId === opponentId) throw new Error('Cannot battle yourself');
  const opponent = db.players.get(opponentId);
  if (!opponent) throw new Error('Opponent not found');
  const challengerTeam = validateTeam(challengerId, challengerTeamIds);

  const battle = {
    id: db.nextId(),
    player1Id: challengerId,
    player2Id: opponentId,
    team1Ids: challengerTeam.map((d) => d.id),
    team2Ids: null, // set on accept
    activeIndex1: firstNonFaintedIndex(challengerTeam),
    activeIndex2: null,
    turnPlayerId: null, // set on accept
    status: 'pending_acceptance',
    winnerId: null,
    log: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.battles.set(battle.id, battle);
  return battle;
}

function acceptChallenge(battleId, opponentId, opponentTeamIds) {
  const battle = db.battles.get(battleId);
  if (!battle) throw new Error('Battle not found');
  if (battle.status !== 'pending_acceptance') throw new Error('This challenge is no longer pending');
  if (battle.player2Id !== opponentId) throw new Error('This challenge is not addressed to you');

  const opponentTeam = validateTeam(opponentId, opponentTeamIds);
  battle.team2Ids = opponentTeam.map((d) => d.id);
  battle.activeIndex2 = firstNonFaintedIndex(opponentTeam);
  battle.status = 'active';
  battle.turnPlayerId = battle.player1Id; // challenger acts first
  battle.updatedAt = Date.now();
  return battle;
}

function declineChallenge(battleId, opponentId) {
  const battle = db.battles.get(battleId);
  if (!battle) throw new Error('Battle not found');
  if (battle.status !== 'pending_acceptance') throw new Error('This challenge is no longer pending');
  if (battle.player2Id !== opponentId) throw new Error('This challenge is not addressed to you');
  battle.status = 'declined';
  battle.updatedAt = Date.now();
  return battle;
}

// ---- Group Titan Battles ----
// Multiple players vs one shared Titan. Each participant pays their own
// entry fee when joining (no spec given on fee-splitting, so this is my
// own reasonable default, matching how solo works). Turns rotate
// through all confirmed, non-eliminated participants in join order; a
// participant is "eliminated" once their whole team has fainted, and is
// skipped in the rotation from then on. The Titan counter-attacks
// whichever participant just acted, same as solo.

const GROUP_TITAN_MAX_PARTICIPANTS = 10; // confirmed cap, includes the creator

function createGroupTitanChallenge(creatorId, invitedPlayerIds, creatorTeamIds) {
  const creator = db.players.get(creatorId);
  if (!creator) throw new Error('Player not found');
  if (!Array.isArray(invitedPlayerIds) || !invitedPlayerIds.length) {
    throw new Error('Invite at least one other player');
  }
  if (invitedPlayerIds.length > GROUP_TITAN_MAX_PARTICIPANTS - 1) {
    throw new Error(`A group encounter can have at most ${GROUP_TITAN_MAX_PARTICIPANTS} participants total (including you) — invite up to ${GROUP_TITAN_MAX_PARTICIPANTS - 1} others`);
  }
  invitedPlayerIds.forEach((id) => {
    if (!db.players.get(id)) throw new Error(`Player ${id} not found`);
    if (id === creatorId) throw new Error('Cannot invite yourself');
  });
  const creatorTeam = validateTeam(creatorId, creatorTeamIds);
  if (creator.crystalBalance < TITAN_ENTRY_FEE) {
    throw new Error(`Not enough crystals — joining costs ${TITAN_ENTRY_FEE}`);
  }
  const now = Date.now();
  if (creator.titanCooldownUntil && now < creator.titanCooldownUntil) {
    const minsLeft = Math.ceil((creator.titanCooldownUntil - now) / 60000);
    throw new Error(`Titan encounters are on cooldown for another ~${minsLeft}m`);
  }

  creator.crystalBalance -= TITAN_ENTRY_FEE;
  db.crystalTransactions.push({ id: db.nextId(), playerId: creatorId, amount: -TITAN_ENTRY_FEE, source: 'titan_entry', createdAt: now });
  creator.titanCooldownUntil = now + TITAN_COOLDOWN_MS;

  const battle = {
    id: db.nextId(),
    isGroupTitanBattle: true,
    creatorId,
    status: 'forming', // forming -> active -> finished
    invitedPlayerIds,
    participantIds: [creatorId],
    teamsByParticipant: { [creatorId]: creatorTeam.map((d) => d.id) },
    activeIndexByParticipant: { [creatorId]: firstNonFaintedIndex(creatorTeam) },
    eliminatedParticipantIds: [],
    team2Ids: null, // Titan created when the fight actually starts
    activeIndex2: 0,
    turnParticipantId: null,
    winnerParticipantIds: null,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
  db.battles.set(battle.id, battle);
  return battle;
}

function joinGroupTitanBattle(battleId, playerId, teamDroidIds) {
  const battle = db.battles.get(battleId);
  if (!battle || !battle.isGroupTitanBattle) throw new Error('Group Titan battle not found');
  if (battle.status !== 'forming') throw new Error('This encounter is no longer accepting joiners');
  if (!battle.invitedPlayerIds.includes(playerId)) throw new Error('You were not invited to this encounter');
  if (battle.participantIds.includes(playerId)) throw new Error('Already joined');

  const player = db.players.get(playerId);
  const now = Date.now();
  if (player.titanCooldownUntil && now < player.titanCooldownUntil) {
    const minsLeft = Math.ceil((player.titanCooldownUntil - now) / 60000);
    throw new Error(`Your Titan cooldown has another ~${minsLeft}m left`);
  }
  if (player.crystalBalance < TITAN_ENTRY_FEE) {
    throw new Error(`Not enough crystals — joining costs ${TITAN_ENTRY_FEE}`);
  }
  const team = validateTeam(playerId, teamDroidIds);

  player.crystalBalance -= TITAN_ENTRY_FEE;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -TITAN_ENTRY_FEE, source: 'titan_entry', createdAt: now });
  player.titanCooldownUntil = now + TITAN_COOLDOWN_MS;

  battle.participantIds.push(playerId);
  battle.teamsByParticipant[playerId] = team.map((d) => d.id);
  battle.activeIndexByParticipant[playerId] = firstNonFaintedIndex(team);
  battle.updatedAt = now;
  return battle;
}

function startGroupTitanBattle(battleId, creatorId) {
  const battle = db.battles.get(battleId);
  if (!battle || !battle.isGroupTitanBattle) throw new Error('Group Titan battle not found');
  if (battle.creatorId !== creatorId) throw new Error('Only the person who started this encounter can begin the fight');
  if (battle.status !== 'forming') throw new Error('This encounter has already started');

  const titanDef = pickTitan();
  const titanDroid = {
    id: db.nextId(),
    playerId: null,
    isTitan: true,
    titanName: titanDef.name,
    titanHp: titanDef.hp,
    titanAttack: titanDef.attack,
    variant: 'standard',
    currentHpDamage: 0,
  };
  db.ownedDroids.set(titanDroid.id, titanDroid);

  battle.team2Ids = [titanDroid.id];
  // Remembered so the reward step knows which Titan was fought and can
  // hand out the right material drop.
  battle.titanDef = titanDef;
  battle.titanName = titanDef.name;
  battle.status = 'active';
  battle.turnParticipantId = battle.participantIds[0];
  battle.updatedAt = Date.now();
  return battle;
}

function nextParticipantId(battle, afterPlayerId) {
  const active = battle.participantIds.filter((id) => !battle.eliminatedParticipantIds.includes(id));
  if (!active.length) return null;
  const idx = active.indexOf(afterPlayerId);
  return active[(idx + 1) % active.length];
}

function attackGroupTitan(battleId, playerId, opts = {}) {
  const battle = db.battles.get(battleId);
  if (!battle || !battle.isGroupTitanBattle) throw new Error('Group Titan battle not found');
  if (battle.status === 'forming') throw new Error('This encounter hasn\'t started yet');
  if (battle.status !== 'active') throw new Error('This battle has already ended');
  if (battle.turnParticipantId !== playerId) throw new Error('It\'s not your turn');

  const myTeamIds = battle.teamsByParticipant[playerId];
  const myTeam = myTeamIds.map((id) => db.ownedDroids.get(id));
  const myActive = myTeam[battle.activeIndexByParticipant[playerId]];
  const titanDroid = db.ownedDroids.get(battle.team2Ids[0]);

  const myEnriched = workshop.enrichDroid(myActive);
  const companionMultiplier = myEnriched.buffIsActive && myEnriched.companionBuffType === 'damage'
    ? 1 + myEnriched.companionBuffPercent / 100
    : 1;
  const variance = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
  const sp = resolveBossSpecial(battle, myActive, myEnriched, opts);
  const damage = sp.mult === 0
    ? 0
    : Math.max(1, Math.round(myEnriched.attack * companionMultiplier * variance * (sp.used ? sp.mult : 1)));
  if (damage > 0) titanDroid.currentHpDamage = (titanDroid.currentHpDamage || 0) + damage;
  const titanFainted = workshop.enrichDroid(titanDroid).fainted;

  const logEntry = {
    turn: battle.log.length + 1,
    attackerPlayerId: playerId,
    attackerDroidName: myEnriched.speciesName,
    defenderDroidName: titanDroid.titanName,
    damage,
    defenderFainted: titanFainted,
    usedSpecial: sp.used,
    specialName: sp.used ? sp.special.name : null,
    specialEffect: sp.effect,
    charge: sp.charge,
    chargeRequired: SPECIAL_CHARGE_REQUIRED,
  };
  battle.log.push(logEntry);

  if (titanFainted) {
    battle.status = 'finished';
    battle.winnerParticipantIds = battle.participantIds.filter((id) => !battle.eliminatedParticipantIds.includes(id));
    battle.updatedAt = Date.now();
    // Every still-active participant gets a full individual reward —
    // group content should reward everyone who showed up, not just
    // whoever landed the final hit.
    battle.titanExtras = {};
    battle.winnerParticipantIds.forEach((pid) => {
      const p = db.players.get(pid);
      levels.awardXp(pid, 'battleWin');
      p.battlesWon = (p.battlesWon || 0) + 1;
      ach.track(pid, 'battlesWon');
      require('./ladder').award(pid, battle.isApexBattle ? 'apexWin' : 'titanWin');
      require('./seasonpass').awardXp(pid, battle.isApexBattle ? 'apexWin' : 'titanWin');
      p.battleWinStreak = (p.battleWinStreak || 0) + 1;
      ach.track(pid, 'battleWinStreak', p.battleWinStreak, 'max');
      p.paint = (p.paint || 0) + TITAN_REWARDS.paint;
      p.novaChips = (p.novaChips || 0) + TITAN_REWARDS.novaChips;
      p.repairKits = (p.repairKits || 0) + TITAN_REWARDS.repairKits;
      p.beacons = (p.beacons || 0) + TITAN_REWARDS.beacons;
      battle.titanExtras[pid] = awardTitanExtras(p, battle.titanDef, battle.winnerParticipantIds);
      const tubesWon = randInt(2, 4);
      p.energyTubes = (p.energyTubes || 0) + tubesWon;
    });
    battle.scaffitanCaptureAvailable = true;
    battle.scaffitanCaptureUsedBy = [];
    logEntry.groupWin = true;
    return { battle, logEntry };
  }

  // Titan counters against whoever just attacked — unless it's stunned,
  // which is what makes a stun special actually worth using here.
  let counterDamage = 0;
  let myFainted = false;
  if ((battle.bossStunTurns || 0) > 0) {
    battle.bossStunTurns -= 1;
    logEntry.bossStunned = true;
  } else {
    const variance2 = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
    counterDamage = Math.max(1, Math.round(titanDroid.titanAttack * variance2));
    myActive.currentHpDamage = (myActive.currentHpDamage || 0) + counterDamage;
    myFainted = workshop.enrichDroid(myActive).fainted;
    logEntry.counterDamage = counterDamage;
    logEntry.counterFainted = myFainted;
  }

  if (myFainted) {
    const nextIdx = firstNonFaintedIndex(myTeam);
    if (nextIdx === -1) {
      battle.eliminatedParticipantIds.push(playerId);
    } else {
      battle.activeIndexByParticipant[playerId] = nextIdx;
    }
  }

  const next = nextParticipantId(battle, playerId);
  if (!next) {
    // every participant's whole team has fainted — Titan wins, no reward on a loss (confirmed)
    battle.status = 'finished';
    battle.winnerParticipantIds = [];
    logEntry.groupLoss = true;
  } else {
    battle.turnParticipantId = next;
  }
  battle.updatedAt = Date.now();
  return { battle, logEntry };
}

function createSoloTitanBattle(playerId, teamDroidIds) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  const now = Date.now();
  if (player.titanCooldownUntil && now < player.titanCooldownUntil) {
    const minsLeft = Math.ceil((player.titanCooldownUntil - now) / 60000);
    throw new Error(`Titan encounters are on cooldown for another ~${minsLeft}m`);
  }
  if (player.crystalBalance < TITAN_ENTRY_FEE) {
    throw new Error(`Not enough crystals — a Titan encounter costs ${TITAN_ENTRY_FEE}`);
  }
  const playerTeam = validateTeam(playerId, teamDroidIds); // validate everything before deducting anything

  player.crystalBalance -= TITAN_ENTRY_FEE;
  db.crystalTransactions.push({ id: db.nextId(), playerId, amount: -TITAN_ENTRY_FEE, source: 'titan_entry', createdAt: now });
  player.titanCooldownUntil = now + TITAN_COOLDOWN_MS;

  // The Titan is stored as a real ownedDroids-style entry (playerId:
  // null, isTitan flag) so it can reuse the exact same attack/faint
  // logic already tested for PVP — no separate combat code path.
  const titanDef = pickTitan();
  const titanDroid = {
    id: db.nextId(),
    playerId: null,
    isTitan: true,
    titanName: titanDef.name,
    titanHp: titanDef.hp,
    titanAttack: titanDef.attack,
    variant: 'standard',
    currentHpDamage: 0,
  };
  db.ownedDroids.set(titanDroid.id, titanDroid);

  const battle = {
    id: db.nextId(),
    player1Id: playerId,
    player2Id: null,
    isTitanBattle: true,
    team1Ids: playerTeam.map((d) => d.id),
    team2Ids: [titanDroid.id],
    activeIndex1: firstNonFaintedIndex(playerTeam),
    activeIndex2: 0,
    turnPlayerId: playerId, // player always acts first against a Titan
    status: 'active',
    winnerId: null,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
  db.battles.set(battle.id, battle);
  return battle;
}

function createBattle(player1Id, player2Id, team1Ids, team2Ids) {
  if (player1Id === player2Id) throw new Error('Cannot battle yourself');
  const team1 = validateTeam(player1Id, team1Ids);
  const team2 = validateTeam(player2Id, team2Ids);

  const battle = {
    id: db.nextId(),
    player1Id,
    player2Id,
    team1Ids: team1.map((d) => d.id),
    team2Ids: team2.map((d) => d.id),
    activeIndex1: firstNonFaintedIndex(team1),
    activeIndex2: firstNonFaintedIndex(team2),
    turnPlayerId: player1Id, // challenger acts first — simple, deterministic, no coin-flip needed
    status: 'active',
    winnerId: null,
    log: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.battles.set(battle.id, battle);
  return battle;
}

// Swap the active droid. Costs your turn — the opponent goes next.
function swapDroid(battleId, playerId, droidId) {
  const battle = db.battles.get(battleId);
  if (!battle) throw new Error('Battle not found');
  if (battle.status !== 'active') throw new Error('This battle has already ended');
  if (battle.turnPlayerId !== playerId) throw new Error("It's not your turn");

  const isPlayer1 = playerId === battle.player1Id;
  const teamIds = isPlayer1 ? battle.team1Ids : battle.team2Ids;
  const idxKey = isPlayer1 ? 'activeIndex1' : 'activeIndex2';
  const target = teamIds.indexOf(droidId);
  if (target === -1) throw new Error('That droid is not on your team');
  if (target === battle[idxKey]) throw new Error('That droid is already active');
  const droid = db.ownedDroids.get(droidId);
  if (!droid || isFainted(droid)) throw new Error('That droid has fainted');

  battle[idxKey] = target;
  const logEntry = {
    turn: battle.log.length + 1,
    attackerPlayerId: playerId,
    swappedTo: workshop.enrichDroid(droid).speciesName,
  };
  battle.log.push(logEntry);

  // Swapping uses the turn, so honour any stun the opponent owes.
  const nextPlayerId = isPlayer1 ? battle.player2Id : battle.player1Id;
  battle.stunnedUntilTurn = battle.stunnedUntilTurn || {};
  if ((battle.stunnedUntilTurn[nextPlayerId] || 0) > 0) {
    battle.stunnedUntilTurn[nextPlayerId] -= 1;
    logEntry.opponentStunnedSkipped = true;
    battle.turnPlayerId = playerId;
  } else {
    battle.turnPlayerId = nextPlayerId;
  }
  battle.updatedAt = Date.now();
  return { battle, logEntry };
}

function attack(battleId, playerId, opts = {}) {
  const battle = db.battles.get(battleId);
  if (!battle) throw new Error('Battle not found');
  if (battle.status === 'pending_acceptance') throw new Error('This challenge hasn\'t been accepted yet');
  if (battle.status !== 'active') throw new Error('This battle has already ended');
  if (battle.turnPlayerId !== playerId) throw new Error("It's not your turn");

  const isPlayer1 = playerId === battle.player1Id;
  const attackerTeamIds = isPlayer1 ? battle.team1Ids : battle.team2Ids;
  const defenderTeamIds = isPlayer1 ? battle.team2Ids : battle.team1Ids;
  const attackerIdx = isPlayer1 ? battle.activeIndex1 : battle.activeIndex2;
  const defenderIdxKey = isPlayer1 ? 'activeIndex2' : 'activeIndex1';

  const attackerDroid = db.ownedDroids.get(attackerTeamIds[attackerIdx]);
  const defenderTeam = defenderTeamIds.map((id) => db.ownedDroids.get(id));
  const defenderDroid = defenderTeam[battle[defenderIdxKey]];

  const attackerEnriched = workshop.enrichDroid(attackerDroid);
  const companionMultiplier = attackerEnriched.buffIsActive && attackerEnriched.companionBuffType === 'damage'
    ? 1 + attackerEnriched.companionBuffPercent / 100
    : 1;
  const variance = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;

  // Special attack: only if charged and requested. Consumes the charge.
  const wantsSpecial = Boolean(opts.useSpecial);
  const special = specialFor(attackerEnriched.rarity);
  let usedSpecial = false;
  let specialEffect = null;
  if (wantsSpecial) {
    if (!isSpecialReady(battle, attackerDroid.id)) {
      throw new Error(`${special.name} isn't charged yet (${chargeOf(battle, attackerDroid.id)}/${SPECIAL_CHARGE_REQUIRED})`);
    }
    usedSpecial = true;
    clearCharge(battle, attackerDroid.id);
  }

  const mult = usedSpecial ? (special.damageMult || 0) : 1;
  let damage = Math.max(usedSpecial && special.kind === 'heal' ? 0 : 1,
    Math.round(attackerEnriched.attack * companionMultiplier * variance * mult));

  if (usedSpecial && special.kind === 'heal') {
    // Heals the attacker instead of dealing damage.
    damage = 0;
    const maxHp = attackerEnriched.hp;
    const healed = Math.round(maxHp * (special.healPercent / 100));
    attackerDroid.currentHpDamage = Math.max(0, (attackerDroid.currentHpDamage || 0) - healed);
    specialEffect = { kind: 'heal', healed };
  }

  if (damage > 0) defenderDroid.currentHpDamage = (defenderDroid.currentHpDamage || 0) + damage;
  const defenderFainted = isFainted(defenderDroid);

  // Droid Memory — count the kill against the attacking droid.
  if (defenderFainted) {
    try {
      memory.bump(attackerDroid, battle.isTitanBattle ? 'bossesDefeated' : 'droidsDefeated');
    } catch (e) {}
  }

  if (usedSpecial && special.kind === 'stun' && !defenderFainted) {
    // Stun makes the defender lose their next turn(s).
    battle.stunnedUntilTurn = battle.stunnedUntilTurn || {};
    const victimId = isPlayer1 ? battle.player2Id : battle.player1Id;
    battle.stunnedUntilTurn[victimId] = (battle.stunnedUntilTurn[victimId] || 0) + special.stunTurns;
    specialEffect = { kind: 'stun', turns: special.stunTurns };
  }

  if (usedSpecial && special.kind === 'switch' && !defenderFainted) {
    // Force the opponent's next living droid forward.
    const alt = defenderTeam.findIndex((d, i) => i !== battle[defenderIdxKey] && !isFainted(d));
    if (alt !== -1) {
      battle[defenderIdxKey] = alt;
      specialEffect = { kind: 'switch', to: workshop.enrichDroid(defenderTeam[alt]).speciesName };
    }
  }

  // Normal attacks build charge; specials don't charge themselves.
  const chargeNow = usedSpecial ? 0 : addCharge(battle, attackerDroid.id);

  const logEntry = {
    turn: battle.log.length + 1,
    attackerPlayerId: playerId,
    attackerDroidName: attackerEnriched.speciesName,
    defenderDroidName: workshop.enrichDroid(defenderDroid).speciesName,
    damage,
    defenderFainted,
    usedSpecial,
    specialName: usedSpecial ? special.name : null,
    specialEffect,
    charge: chargeNow,
    chargeRequired: SPECIAL_CHARGE_REQUIRED,
  };
  battle.log.push(logEntry);

  if (defenderFainted) {
    const nextIdx = firstNonFaintedIndex(defenderTeam);
    if (nextIdx === -1) {
      battle.status = 'finished';
      battle.winnerId = playerId;
      battle.updatedAt = Date.now();
      // Every droid that took the field records the battle; the winning
      // side also records the win.
      try {
        const winIds = playerId === battle.player1Id ? battle.team1Ids : battle.team2Ids;
        const loseIds = playerId === battle.player1Id ? battle.team2Ids : battle.team1Ids;
        (winIds || []).forEach((id) => memory.bumpMany(id, { battles: 1, battlesWon: 1 }));
        (loseIds || []).forEach((id) => memory.bumpMany(id, { battles: 1 }));
      } catch (e) {}
      if (battle.isTitanBattle) {
        const winner = db.players.get(playerId);
        winner.paint = (winner.paint || 0) + TITAN_REWARDS.paint;
        winner.novaChips = (winner.novaChips || 0) + TITAN_REWARDS.novaChips;
        winner.repairKits = (winner.repairKits || 0) + TITAN_REWARDS.repairKits;
        winner.beacons = (winner.beacons || 0) + TITAN_REWARDS.beacons;
        const tubesWon = randInt(2, 4);
        winner.energyTubes = (winner.energyTubes || 0) + tubesWon;
        logEntry.titanRewards = { ...TITAN_REWARDS, energyTubes: tubesWon };

        battle.scaffitanCaptureAvailable = true;
        battle.scaffitanCaptureUsed = false;
      } else {
        const winner = db.players.get(playerId);
        winner.crystalBalance += PVP_WIN_CRYSTAL_REWARD;
        db.crystalTransactions.push({ id: db.nextId(), playerId, amount: PVP_WIN_CRYSTAL_REWARD, source: 'pvp_battle_win', createdAt: Date.now() });
        logEntry.crystalsAwarded = PVP_WIN_CRYSTAL_REWARD;
      }
      return { battle, logEntry };
    }
    battle[defenderIdxKey] = nextIdx;
  }

  // Stun: if the opponent owes stunned turns, they're skipped and the
  // turn comes straight back — that's what makes the effect real.
  const nextPlayerId = isPlayer1 ? battle.player2Id : battle.player1Id;
  battle.stunnedUntilTurn = battle.stunnedUntilTurn || {};
  if ((battle.stunnedUntilTurn[nextPlayerId] || 0) > 0) {
    battle.stunnedUntilTurn[nextPlayerId] -= 1;
    logEntry.opponentStunnedSkipped = true;
    battle.turnPlayerId = playerId; // stunned side loses this turn
  } else {
    battle.turnPlayerId = nextPlayerId;
  }
  battle.updatedAt = Date.now();

  // No human plays the Titan's side — it counter-attacks immediately
  // so the flow still works within the same "check back later" polling
  // model, rather than needing a separate AI-turn trigger.
  if (battle.isTitanBattle && battle.status === 'active' && battle.turnPlayerId === null) {
    resolveTitanCounterAttack(battle);
  }

  return { battle, logEntry };
}

function resolveTitanCounterAttack(battle) {
  const titanDroid = db.ownedDroids.get(battle.team2Ids[0]);
  const playerTeam = battle.team1Ids.map((id) => db.ownedDroids.get(id));
  const playerActive = playerTeam[battle.activeIndex1];

  const variance = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
  const damage = Math.max(1, Math.round(titanDroid.titanAttack * variance));
  playerActive.currentHpDamage = (playerActive.currentHpDamage || 0) + damage;
  const playerFainted = workshop.enrichDroid(playerActive).fainted;

  battle.log.push({
    turn: battle.log.length + 1,
    attackerPlayerId: null,
    attackerDroidName: titanDroid.titanName,
    defenderDroidName: workshop.enrichDroid(playerActive).speciesName,
    damage,
    defenderFainted: playerFainted,
  });

  if (playerFainted) {
    const nextIdx = firstNonFaintedIndex(playerTeam);
    if (nextIdx === -1) {
      battle.status = 'finished';
      battle.winnerId = null; // Titan won — no reward on a loss (confirmed, supersedes the earlier consolation-tubes spec)
      battle.updatedAt = Date.now();
      return;
    }
    battle.activeIndex1 = nextIdx;
  }

  battle.turnPlayerId = battle.player1Id; // back to the human
  battle.updatedAt = Date.now();
}

function getBattleView(battleId) {
  const battle = db.battles.get(battleId);
  if (!battle) throw new Error('Battle not found');
  const enrichTeam = (ids) => (ids || []).map((id) => workshop.enrichDroid(db.ownedDroids.get(id)));

  // Apex encounters share the group Titan's multi-participant shape, so
  // they share this view branch — the `isApexBattle` flag on the battle
  // is what the client keys its Apex styling off.
  if (battle.isGroupTitanBattle || battle.isApexBattle) {
    const teamsView = {};
    Object.entries(battle.teamsByParticipant).forEach(([pid, ids]) => {
      teamsView[pid] = enrichTeam(ids);
    });
    // Charge state for every participant's droids, same shape the PVP
    // view uses so the client can render one charge bar component.
    const specialState = {};
    Object.values(battle.teamsByParticipant).forEach((ids) => {
      (ids || []).forEach((id) => {
        const d = db.ownedDroids.get(id);
        if (!d) return;
        const sp = specialFor(workshop.enrichDroid(d).rarity);
        specialState[id] = {
          name: sp.name,
          note: sp.note,
          charge: chargeOf(battle, id),
          required: SPECIAL_CHARGE_REQUIRED,
          ready: isSpecialReady(battle, id),
        };
      });
    });

    return {
      ...battle,
      teamsByParticipant: teamsView,
      titan: battle.team2Ids ? enrichTeam(battle.team2Ids)[0] : null,
      specialState,
      bossStunTurns: battle.bossStunTurns || 0,
    };
  }

  // Per-droid special/charge state so the client can show a charge bar
  // and enable the special button at the right moment.
  const specialState = {};
  [...(battle.team1Ids || []), ...(battle.team2Ids || [])].forEach((id) => {
    const d = db.ownedDroids.get(id);
    if (!d) return;
    const rarity = workshop.enrichDroid(d).rarity;
    const sp = specialFor(rarity);
    specialState[id] = {
      name: sp.name,
      note: sp.note,
      charge: chargeOf(battle, id),
      required: SPECIAL_CHARGE_REQUIRED,
      ready: isSpecialReady(battle, id),
    };
  });

  return {
    ...battle,
    team1: enrichTeam(battle.team1Ids),
    team2: battle.team2Ids ? enrichTeam(battle.team2Ids) : null,
    specialState,
  };
}

function getBattlesForPlayer(playerId) {
  return [...db.battles.values()]
    .filter((b) => {
      if (b.isGroupTitanBattle || b.isApexBattle) {
        return (b.participantIds && b.participantIds.includes(playerId)) || (b.invitedPlayerIds && b.invitedPlayerIds.includes(playerId));
      }
      return b.player1Id === playerId || b.player2Id === playerId;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((b) => getBattleView(b.id));
}

// ============================================================
// APEX ENCOUNTERS
// ============================================================
// Structurally parallel to the group Titan flow (create -> join ->
// start -> attack) but kept as separate functions rather than flags on
// the Titan path. The two are meant to diverge as they get tuned, and
// interleaving them would make every future change to one a risk to the
// other.

function apexRosterPick() {
  const apexSpecies = db.apexSpeciesList();
  if (!apexSpecies.length) throw new Error('No Apex species defined');
  return apexSpecies[Math.floor(Math.random() * apexSpecies.length)];
}

function chargeApexEntry(player, now) {
  if (player.crystalBalance < APEX_ENTRY_FEE) {
    throw new Error(`Not enough crystals — an Apex encounter costs ${APEX_ENTRY_FEE}`);
  }
  if (player.apexCooldownUntil && now < player.apexCooldownUntil) {
    const minsLeft = Math.ceil((player.apexCooldownUntil - now) / 60000);
    throw new Error(`Apex encounters are on cooldown for another ~${minsLeft}m`);
  }
  player.crystalBalance -= APEX_ENTRY_FEE;
  db.crystalTransactions.push({ id: db.nextId(), playerId: player.id, amount: -APEX_ENTRY_FEE, source: 'apex_entry', createdAt: now });
  player.apexCooldownUntil = now + APEX_COOLDOWN_MS;
}

function createApexChallenge(creatorId, invitedPlayerIds, creatorTeamIds) {
  const creator = db.players.get(creatorId);
  if (!creator) throw new Error('Player not found');
  const invited = Array.isArray(invitedPlayerIds) ? invitedPlayerIds : [];
  if (invited.length > APEX_MAX_PARTICIPANTS - 1) {
    throw new Error(`An Apex encounter holds at most ${APEX_MAX_PARTICIPANTS} players including you`);
  }
  invited.forEach((id) => {
    if (!db.players.get(id)) throw new Error(`Player ${id} not found`);
    if (id === creatorId) throw new Error('Cannot invite yourself');
  });
  const creatorTeam = validateTeam(creatorId, creatorTeamIds);
  const now = Date.now();
  chargeApexEntry(creator, now);

  const battle = {
    id: db.nextId(),
    isApexBattle: true,
    creatorId,
    status: 'forming',
    invitedPlayerIds: invited,
    participantIds: [creatorId],
    teamsByParticipant: { [creatorId]: creatorTeam.map((d) => d.id) },
    activeIndexByParticipant: { [creatorId]: firstNonFaintedIndex(creatorTeam) },
    eliminatedParticipantIds: [],
    team2Ids: null,
    activeIndex2: 0,
    turnParticipantId: null,
    winnerParticipantIds: null,
    apexSpeciesId: null,
    apexName: null,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
  db.battles.set(battle.id, battle);
  return battle;
}

function joinApexBattle(battleId, playerId, teamDroidIds) {
  const battle = db.battles.get(battleId);
  if (!battle || !battle.isApexBattle) throw new Error('Apex encounter not found');
  if (battle.status !== 'forming') throw new Error('This encounter is no longer accepting joiners');
  if (!battle.invitedPlayerIds.includes(playerId)) throw new Error('You were not invited to this encounter');
  if (battle.participantIds.includes(playerId)) throw new Error('Already joined');
  if (battle.participantIds.length >= APEX_MAX_PARTICIPANTS) throw new Error('This encounter is full');

  const player = db.players.get(playerId);
  const now = Date.now();
  const team = validateTeam(playerId, teamDroidIds);
  chargeApexEntry(player, now);

  battle.participantIds.push(playerId);
  battle.teamsByParticipant[playerId] = team.map((d) => d.id);
  battle.activeIndexByParticipant[playerId] = firstNonFaintedIndex(team);
  battle.updatedAt = now;
  return battle;
}

function startApexBattle(battleId, creatorId) {
  const battle = db.battles.get(battleId);
  if (!battle || !battle.isApexBattle) throw new Error('Apex encounter not found');
  if (battle.creatorId !== creatorId) throw new Error('Only the person who started this encounter can begin the fight');
  if (battle.status !== 'forming') throw new Error('This encounter has already started');

  // Which of the 30 Apex droids shows up is rolled here, at start time —
  // so the group doesn't know what they're facing while recruiting.
  const species = apexRosterPick();
  const apexDroid = {
    id: db.nextId(),
    playerId: null,
    isTitan: true,        // reuses the same enrichDroid boss path as the Titan
    isApexBoss: true,
    titanName: species.name,
    titanHp: APEX_BATTLE_HP,
    titanAttack: APEX_BATTLE_ATTACK,
    speciesId: species.id, // so the client can render the real art
    variant: 'standard',
    currentHpDamage: 0,
  };
  db.ownedDroids.set(apexDroid.id, apexDroid);

  battle.team2Ids = [apexDroid.id];
  battle.apexSpeciesId = species.id;
  battle.apexName = species.name;
  battle.status = 'active';
  battle.turnParticipantId = battle.participantIds[0];
  battle.soloWarning = battle.participantIds.length === 1;
  battle.updatedAt = Date.now();
  return battle;
}

function attackApex(battleId, playerId, opts = {}) {
  const battle = db.battles.get(battleId);
  if (!battle || !battle.isApexBattle) throw new Error('Apex encounter not found');
  if (battle.status === 'forming') throw new Error('This encounter hasn\'t started yet');
  if (battle.status !== 'active') throw new Error('This battle has already ended');
  if (battle.turnParticipantId !== playerId) throw new Error('It\'s not your turn');

  const myTeamIds = battle.teamsByParticipant[playerId];
  const myTeam = myTeamIds.map((id) => db.ownedDroids.get(id));
  const myActive = myTeam[battle.activeIndexByParticipant[playerId]];
  const apexDroid = db.ownedDroids.get(battle.team2Ids[0]);

  const myEnriched = workshop.enrichDroid(myActive);
  const companionMultiplier = workshop.companionBuffMultiplier(playerId, 'damage');
  const variance = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
  const sp = resolveBossSpecial(battle, myActive, myEnriched, opts);
  const damage = sp.mult === 0
    ? 0
    : Math.max(1, Math.round(myEnriched.attack * companionMultiplier * variance * (sp.used ? sp.mult : 1)));
  if (damage > 0) apexDroid.currentHpDamage = (apexDroid.currentHpDamage || 0) + damage;
  const apexHpRemaining = Math.max(0, APEX_BATTLE_HP - apexDroid.currentHpDamage);
  const apexDown = apexHpRemaining <= 0;

  const logEntry = {
    turn: battle.log.length + 1,
    attackerPlayerId: playerId,
    attackerDroidName: myEnriched.speciesName,
    defenderDroidName: apexDroid.titanName,
    damage,
    defenderFainted: apexDown,
    apexHpRemaining,
    usedSpecial: sp.used,
    specialName: sp.used ? sp.special.name : null,
    specialEffect: sp.effect,
    charge: sp.charge,
    chargeRequired: SPECIAL_CHARGE_REQUIRED,
  };
  battle.log.push(logEntry);

  if (apexDown) {
    battle.status = 'finished';
    battle.winnerParticipantIds = battle.participantIds.filter((id) => !battle.eliminatedParticipantIds.includes(id));
    battle.updatedAt = Date.now();
    battle.cubeRewards = {};
    // Everyone still standing gets a full reward, matching how the group
    // Titan pays out — showing up and surviving is the contribution.
    battle.winnerParticipantIds.forEach((pid) => {
      const p = db.players.get(pid);
      p.paint = (p.paint || 0) + APEX_BATTLE_REWARDS.paint;
      p.novaChips = (p.novaChips || 0) + APEX_BATTLE_REWARDS.novaChips;
      p.repairKits = (p.repairKits || 0) + APEX_BATTLE_REWARDS.repairKits;
      p.beacons = (p.beacons || 0) + APEX_BATTLE_REWARDS.beacons;
      // The third confirmed cube route: defeating an Apex.
      const cubes = db.rollApexCubeDrop();
      p.apexCubes = (p.apexCubes || 0) + cubes;
      battle.cubeRewards[pid] = cubes;
      // Guild Token for beating an Apex alongside a guildmate. No Titan
      // material drop here — Apex pays in Cubes.
      awardTitanExtras(p, null, battle.winnerParticipantIds);
    });
    logEntry.groupWin = true;
    return { battle, logEntry };
  }

  // Apex counters whoever just attacked — unless stunned.
  let counterDamage = 0;
  let myFainted = false;
  if ((battle.bossStunTurns || 0) > 0) {
    battle.bossStunTurns -= 1;
    logEntry.bossStunned = true;
  } else {
    const variance2 = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
    counterDamage = Math.max(1, Math.round(apexDroid.titanAttack * variance2));
    myActive.currentHpDamage = (myActive.currentHpDamage || 0) + counterDamage;
    myFainted = workshop.enrichDroid(myActive).fainted;
    logEntry.counterDamage = counterDamage;
    logEntry.counterFainted = myFainted;
  }

  if (myFainted) {
    const nextIdx = firstNonFaintedIndex(myTeam);
    if (nextIdx === -1) {
      battle.eliminatedParticipantIds.push(playerId);
    } else {
      battle.activeIndexByParticipant[playerId] = nextIdx;
    }
  }

  const next = nextParticipantId(battle, playerId);
  if (!next) {
    // Whole raid wiped — no reward on a loss, same as the Titan.
    battle.status = 'finished';
    battle.winnerParticipantIds = [];
    logEntry.groupLoss = true;
  } else {
    battle.turnParticipantId = next;
  }
  battle.updatedAt = Date.now();
  return { battle, logEntry };
}


// ---- one-time battle equipment ----
// Augment Core and EMP, plus any Apex-kind Forge item. Equipped BEFORE
// a battle starts and consumed when it does, so there's no mid-fight
// decision to balance — you commit, then fight.
//
// Augment Core buffs everyone on your side; EMP is a field effect that
// suppresses buffs and specials for both players. Both are deliberately
// one-use so they stay a moment rather than a permanent stat.
const BATTLE_EQUIPMENT = {
  augmentCores: { key: 'augmentCores', name: 'Augment Core', icon: 'augcore.png', folder: 'equipment',
    effect: 'team_boost', value: 0.05, blurb: '+5% HP and attack to every droid on your side' },
  emps: { key: 'emps', name: 'EMP', icon: 'emp.png', folder: 'equipment',
    effect: 'field_emp', value: 2, blurb: 'Suppresses all buffs and specials for 2 turns' },
};

function equipBattleItem(playerId, itemKey) {
  const player = db.players.get(playerId);
  if (!player) throw new Error('Player not found');
  if (itemKey === null) { player.equippedBattleItem = null; return { equipped: null }; }
  const item = BATTLE_EQUIPMENT[itemKey];
  if (!item) throw new Error('Unknown battle item');
  if ((player[item.key] || 0) < 1) throw new Error(`You don't own an ${item.name}`);
  player.equippedBattleItem = itemKey;
  return { equipped: itemKey, item };
}

// Consumed at battle start. Returns what was applied so the UI can say.
function consumeBattleItem(playerId) {
  const player = db.players.get(playerId);
  if (!player || !player.equippedBattleItem) return null;
  const item = BATTLE_EQUIPMENT[player.equippedBattleItem];
  if (!item || (player[item.key] || 0) < 1) { player.equippedBattleItem = null; return null; }
  player[item.key] -= 1;
  player.equippedBattleItem = null;
  return item;
}

function battleItemsFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) return { items: [], equipped: null };
  return {
    equipped: player.equippedBattleItem || null,
    items: Object.values(BATTLE_EQUIPMENT).map((i) => ({ ...i, owned: player[i.key] || 0 })),
  };
}

module.exports = { BATTLE_EQUIPMENT, equipBattleItem, consumeBattleItem, battleItemsFor, TITAN_ROSTER, pickTitan, awardTitanExtras, TITAN_TOKEN_DROP_CHANCE, validateTeam, firstNonFaintedIndex, DAMAGE_VARIANCE, createChallenge, acceptChallenge, declineChallenge, createBattle, createSoloTitanBattle, createGroupTitanChallenge, joinGroupTitanBattle, startGroupTitanBattle, attackGroupTitan, attemptScaffitanCapture, attack, swapDroid, specialFor, isSpecialReady, chargeOf, SPECIAL_CHARGE_REQUIRED, SPECIAL_BY_RARITY, getBattleView, getBattlesForPlayer, isFainted, currentHp, createApexChallenge, joinApexBattle, startApexBattle, attackApex, APEX_ENTRY_FEE, APEX_BATTLE_HP, APEX_MAX_PARTICIPANTS };
