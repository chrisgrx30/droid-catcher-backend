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
const TITAN_ROSTER = [
  { name: 'Scaffitan', hp: 2400, attack: 35 },
];
// "Rare" per confirmed design, exact rate not specified — flagged as my
// own placeholder number, easy to retune once you've seen it in play.
const SCAFFITAN_CAPTURE_CHANCE = 0.08;
const TITAN_ENTRY_FEE = 1000;
const TITAN_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours, per confirmed spec
const TITAN_REWARDS = { repairKits: 1, beacons: 1, paint: 5, novaChips: 5 }; // confirmed spec

// No PVP-specific reward was ever specified — only the Titan battle
// reward (1 Repair Kit + 1 Beacon + 5 Paint + 5 Nova Chips) was
// confirmed, and that's explicitly a PVE reward. This is my own
// reasonable default for a PVP win, not a confirmed spec — flagged
// plainly so it's easy to correct.
const PVP_WIN_CRYSTAL_REWARD = 200;

const DAMAGE_VARIANCE = 0.1; // +/-10% per hit, keeps outcomes from feeling too deterministic

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

  const titanDef = TITAN_ROSTER[Math.floor(Math.random() * TITAN_ROSTER.length)];
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

function attackGroupTitan(battleId, playerId) {
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
  const damage = Math.max(1, Math.round(myEnriched.attack * companionMultiplier * variance));
  titanDroid.currentHpDamage = (titanDroid.currentHpDamage || 0) + damage;
  const titanFainted = workshop.enrichDroid(titanDroid).fainted;

  const logEntry = {
    turn: battle.log.length + 1,
    attackerPlayerId: playerId,
    attackerDroidName: myEnriched.speciesName,
    defenderDroidName: titanDroid.titanName,
    damage,
    defenderFainted: titanFainted,
  };
  battle.log.push(logEntry);

  if (titanFainted) {
    battle.status = 'finished';
    battle.winnerParticipantIds = battle.participantIds.filter((id) => !battle.eliminatedParticipantIds.includes(id));
    battle.updatedAt = Date.now();
    // Every still-active participant gets a full individual reward —
    // group content should reward everyone who showed up, not just
    // whoever landed the final hit.
    battle.winnerParticipantIds.forEach((pid) => {
      const p = db.players.get(pid);
      p.paint = (p.paint || 0) + TITAN_REWARDS.paint;
      p.novaChips = (p.novaChips || 0) + TITAN_REWARDS.novaChips;
      p.repairKits = (p.repairKits || 0) + TITAN_REWARDS.repairKits;
      p.beacons = (p.beacons || 0) + TITAN_REWARDS.beacons;
      const tubesWon = randInt(2, 4);
      p.energyTubes = (p.energyTubes || 0) + tubesWon;
    });
    battle.scaffitanCaptureAvailable = true;
    battle.scaffitanCaptureUsedBy = [];
    logEntry.groupWin = true;
    return { battle, logEntry };
  }

  // Titan counters against whoever just attacked
  const variance2 = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
  const counterDamage = Math.max(1, Math.round(titanDroid.titanAttack * variance2));
  myActive.currentHpDamage = (myActive.currentHpDamage || 0) + counterDamage;
  const myFainted = workshop.enrichDroid(myActive).fainted;
  logEntry.counterDamage = counterDamage;
  logEntry.counterFainted = myFainted;

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
  const titanDef = TITAN_ROSTER[Math.floor(Math.random() * TITAN_ROSTER.length)];
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

function attack(battleId, playerId) {
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
  const damage = Math.max(1, Math.round(attackerEnriched.attack * companionMultiplier * variance));

  defenderDroid.currentHpDamage = (defenderDroid.currentHpDamage || 0) + damage;
  const defenderFainted = isFainted(defenderDroid);

  const logEntry = {
    turn: battle.log.length + 1,
    attackerPlayerId: playerId,
    attackerDroidName: attackerEnriched.speciesName,
    defenderDroidName: workshop.enrichDroid(defenderDroid).speciesName,
    damage,
    defenderFainted,
  };
  battle.log.push(logEntry);

  if (defenderFainted) {
    const nextIdx = firstNonFaintedIndex(defenderTeam);
    if (nextIdx === -1) {
      battle.status = 'finished';
      battle.winnerId = playerId;
      battle.updatedAt = Date.now();
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

  battle.turnPlayerId = isPlayer1 ? battle.player2Id : battle.player1Id;
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

  if (battle.isGroupTitanBattle) {
    const teamsView = {};
    Object.entries(battle.teamsByParticipant).forEach(([pid, ids]) => {
      teamsView[pid] = enrichTeam(ids);
    });
    return {
      ...battle,
      teamsByParticipant: teamsView,
      titan: battle.team2Ids ? enrichTeam(battle.team2Ids)[0] : null,
    };
  }

  return {
    ...battle,
    team1: enrichTeam(battle.team1Ids),
    team2: battle.team2Ids ? enrichTeam(battle.team2Ids) : null,
  };
}

function getBattlesForPlayer(playerId) {
  return [...db.battles.values()]
    .filter((b) => {
      if (b.isGroupTitanBattle) {
        return (b.participantIds && b.participantIds.includes(playerId)) || (b.invitedPlayerIds && b.invitedPlayerIds.includes(playerId));
      }
      return b.player1Id === playerId || b.player2Id === playerId;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((b) => getBattleView(b.id));
}

module.exports = { createChallenge, acceptChallenge, declineChallenge, createBattle, createSoloTitanBattle, createGroupTitanChallenge, joinGroupTitanBattle, startGroupTitanBattle, attackGroupTitan, attemptScaffitanCapture, attack, getBattleView, getBattlesForPlayer, isFainted, currentHp };
