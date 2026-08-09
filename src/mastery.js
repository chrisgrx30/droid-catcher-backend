// mastery.js
//
// Buddy Mastery — assign one droid as your buddy and it gains a mastery
// level each day, up to a 30-day cap.
//
// RULES (confirmed)
//   - Only a level-20 droid can be a buddy.
//   - One mastery level per day, capped at 30.
//   - Mastery uses the same stat curve as normal levelling, so a
//     30-mastery buddy is as strong as a level-50 droid would be.
//   - The buddy can still be assigned to a workshop slot and keep
//     farming — being a buddy costs you nothing.
//   - The client shows a mastered droid's level number in purple.
//
// WHY PROGRESS IS COMPUTED, NOT TICKED
// There's no cron job. Mastery is derived from elapsed days since the
// buddy was assigned, evaluated whenever anyone looks. That means it
// keeps accruing while the server is asleep on Render's free tier —
// which matters, because a daily mechanic that only advances when the
// server happens to be awake would quietly cheat players.
//
// Days are counted from the assignment timestamp rather than calendar
// midnight, so nobody gains a level by reassigning just before midnight.

const db = require('./db');

const MASTERY_CAP = 30;
const REQUIRED_DROID_LEVEL = 20;
const MS_PER_MASTERY_LEVEL = 24 * 60 * 60 * 1000;

class MasteryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Mastery earned in the CURRENT stint, plus whatever was banked before.
function currentMastery(droid, now = Date.now()) {
  if (!droid) return 0;
  const banked = droid.masteryLevel || 0;
  if (!droid.buddySince) return Math.min(MASTERY_CAP, banked);
  const elapsedDays = Math.floor((now - droid.buddySince) / MS_PER_MASTERY_LEVEL);
  return Math.min(MASTERY_CAP, banked + Math.max(0, elapsedDays));
}

function msUntilNextLevel(droid, now = Date.now()) {
  if (!droid || !droid.buddySince) return null;
  if (currentMastery(droid, now) >= MASTERY_CAP) return null;
  const elapsed = (now - droid.buddySince) % MS_PER_MASTERY_LEVEL;
  return MS_PER_MASTERY_LEVEL - elapsed;
}

// Same shape as workshop.levelMultiplier (+15% per level), continuing
// the curve past level 20 rather than starting a second one — so
// mastery feels like an extension of levelling, not a parallel stat.
function masteryStatMultiplier(droid, now = Date.now()) {
  return 1 + currentMastery(droid, now) * 0.15;
}

function assignBuddy(playerId, droidId) {
  const player = db.players.get(playerId);
  if (!player) throw new MasteryError('NO_PLAYER', 'Player not found');
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new MasteryError('NO_DROID', 'Droid not found');
  if ((droid.level || 0) < REQUIRED_DROID_LEVEL) {
    throw new MasteryError('LEVEL_TOO_LOW', `Only a level ${REQUIRED_DROID_LEVEL} droid can be your buddy — this one is level ${droid.level}`);
  }

  const now = Date.now();

  // Bank the outgoing buddy's progress so swapping never loses days.
  if (player.buddyDroidId && player.buddyDroidId !== droidId) {
    const old = db.ownedDroids.get(player.buddyDroidId);
    if (old) {
      old.masteryLevel = currentMastery(old, now);
      old.buddySince = null;
    }
  }

  if (player.buddyDroidId === droidId) {
    throw new MasteryError('ALREADY_BUDDY', 'That droid is already your buddy');
  }

  droid.masteryLevel = currentMastery(droid, now); // keep anything banked
  droid.buddySince = now;
  player.buddyDroidId = droidId;
  return statusFor(playerId);
}

function unassignBuddy(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new MasteryError('NO_PLAYER', 'Player not found');
  if (!player.buddyDroidId) throw new MasteryError('NO_BUDDY', 'You have no buddy assigned');
  const droid = db.ownedDroids.get(player.buddyDroidId);
  if (droid) {
    // Banked, not lost. Re-assigning later resumes from here.
    droid.masteryLevel = currentMastery(droid);
    droid.buddySince = null;
  }
  player.buddyDroidId = null;
  return statusFor(playerId);
}

function statusFor(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new MasteryError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  const droid = player.buddyDroidId ? db.ownedDroids.get(player.buddyDroidId) : null;

  const eligible = [...db.ownedDroids.values()]
    .filter((d) => d.playerId === playerId && (d.level || 0) >= REQUIRED_DROID_LEVEL)
    .map((d) => ({ id: d.id, speciesId: d.speciesId, level: d.level, mastery: currentMastery(d, now) }));

  return {
    buddyDroidId: player.buddyDroidId || null,
    mastery: droid ? currentMastery(droid, now) : 0,
    masteryCap: MASTERY_CAP,
    msUntilNextLevel: droid ? msUntilNextLevel(droid, now) : null,
    hoursUntilNextLevel: droid && msUntilNextLevel(droid, now) !== null
      ? Math.ceil(msUntilNextLevel(droid, now) / (60 * 60 * 1000))
      : null,
    statMultiplier: droid ? masteryStatMultiplier(droid, now) : 1,
    requiredLevel: REQUIRED_DROID_LEVEL,
    eligibleDroids: eligible,
  };
}

module.exports = {
  MASTERY_CAP,
  REQUIRED_DROID_LEVEL,
  MS_PER_MASTERY_LEVEL,
  currentMastery,
  msUntilNextLevel,
  masteryStatMultiplier,
  assignBuddy,
  unassignBuddy,
  statusFor,
  MasteryError,
};
