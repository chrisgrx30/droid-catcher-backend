// trades.js
//
// Player-to-player trading. Structured as offer -> accept/decline rather
// than an instant swap, so both sides knowingly consent — and re-validated
// at accept time (not just at offer creation) since state can change while
// an offer sits pending.

const db = require('./db');
const workshop = require('./workshop');

class TradeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isTradeEligible(droid) {
  return Date.now() - droid.capturedAt >= db.TRADE_COOLDOWN_MS;
}

function tradeFeeFor(droidIds) {
  return droidIds.reduce((sum, droidId) => {
    const droid = db.ownedDroids.get(droidId);
    const species = droid && db.droidSpecies.find((s) => s.id === droid.speciesId);
    return sum + (species ? db.TRADE_FEE_BY_RARITY[species.rarity] : 0);
  }, 0);
}

function createTradeOffer({ fromPlayerId, toPlayerId, offeredDroidIds = [], offeredCrystals = 0, requestedDroidIds = [], requestedCrystals = 0 }) {
  if (fromPlayerId === toPlayerId) throw new TradeError('INVALID_TARGET', 'Cannot trade with yourself');

  const fromPlayer = db.players.get(fromPlayerId);
  const toPlayer = db.players.get(toPlayerId);
  if (!fromPlayer || !toPlayer) throw new TradeError('PLAYER_NOT_FOUND', 'Player not found');

  // Ownership + cooldown check at creation time (re-checked again at accept,
  // since time passes and ownership can change while an offer is pending).
  for (const droidId of offeredDroidIds) {
    const droid = db.ownedDroids.get(droidId);
    if (!droid || droid.playerId !== fromPlayerId) {
      throw new TradeError('NOT_OWNED', `Droid ${droidId} is not owned by the offering player`);
    }
    if (!isTradeEligible(droid)) {
      throw new TradeError('COOLDOWN', `Droid ${droidId} is still on trade cooldown`);
    }
  }
  for (const droidId of requestedDroidIds) {
    const droid = db.ownedDroids.get(droidId);
    if (!droid || droid.playerId !== toPlayerId) {
      throw new TradeError('NOT_OWNED', `Droid ${droidId} is not owned by the target player`);
    }
  }

  const offer = {
    id: db.nextId(),
    fromPlayerId,
    toPlayerId,
    offeredDroidIds,
    offeredCrystals,
    requestedDroidIds,
    requestedCrystals,
    status: 'pending',
    createdAt: Date.now(),
    resolvedAt: null,
  };
  db.tradeOffers.set(offer.id, offer);
  return offer;
}

function acceptTradeOffer(tradeId, playerId) {
  const offer = db.tradeOffers.get(tradeId);
  if (!offer) throw new TradeError('NOT_FOUND', 'Trade offer not found');
  if (offer.status !== 'pending') throw new TradeError('NOT_PENDING', 'Trade offer already resolved');
  if (offer.toPlayerId !== playerId) throw new TradeError('NOT_RECIPIENT', 'Only the recipient can accept this trade');

  // Settle both players first so crystal balances/fees are checked against
  // up-to-date numbers, not stale ones from whenever they last opened the app.
  workshop.settleEarnings(offer.fromPlayerId);
  workshop.settleEarnings(offer.toPlayerId);

  const fromPlayer = db.players.get(offer.fromPlayerId);
  const toPlayer = db.players.get(offer.toPlayerId);
  if (!fromPlayer || !toPlayer) throw new TradeError('PLAYER_NOT_FOUND', 'Player not found');

  // Re-validate every droid: still owned by the expected side, still past cooldown.
  const offeredDroids = offer.offeredDroidIds.map((id) => db.ownedDroids.get(id));
  const requestedDroids = offer.requestedDroidIds.map((id) => db.ownedDroids.get(id));

  for (const droid of offeredDroids) {
    if (!droid || droid.playerId !== offer.fromPlayerId) {
      throw new TradeError('NOT_OWNED', 'Offering player no longer owns one of the offered droids');
    }
    if (!isTradeEligible(droid)) {
      throw new TradeError('COOLDOWN', 'One of the offered droids is still on trade cooldown');
    }
  }
  for (const droid of requestedDroids) {
    if (!droid || droid.playerId !== offer.toPlayerId) {
      throw new TradeError('NOT_OWNED', 'Recipient no longer owns one of the requested droids');
    }
    if (!isTradeEligible(droid)) {
      throw new TradeError('COOLDOWN', 'One of the requested droids is still on trade cooldown');
    }
  }

  // Rarity-scaled fee, charged to whoever RECEIVES each droid (keeps trading
  // a convenience, not a strictly-better substitute for capturing rares).
  const feeForFromPlayer = tradeFeeFor(offer.requestedDroidIds); // fromPlayer receives requested droids
  const feeForToPlayer = tradeFeeFor(offer.offeredDroidIds);     // toPlayer receives offered droids

  if (fromPlayer.crystalBalance < offer.offeredCrystals + feeForFromPlayer) {
    throw new TradeError('INSUFFICIENT_CRYSTALS', 'Offering player lacks crystals to cover this trade + fee');
  }
  if (toPlayer.crystalBalance < offer.requestedCrystals + feeForToPlayer) {
    throw new TradeError('INSUFFICIENT_CRYSTALS', 'Recipient lacks crystals to cover this trade + fee');
  }

  // --- execute the swap ---
  // Droids are unassigned from workshop slots (new owner's slot layout may
  // differ) and their capturedAt is reset (restarts the trade cooldown,
  // closing the "immediately re-trade to launder" loophole).
  for (const droid of offeredDroids) {
    droid.playerId = offer.toPlayerId;
    droid.workshopSlotId = null;
    droid.capturedAt = Date.now();
  }
  for (const droid of requestedDroids) {
    droid.playerId = offer.fromPlayerId;
    droid.workshopSlotId = null;
    droid.capturedAt = Date.now();
  }

  const fromNet = offer.requestedCrystals - offer.offeredCrystals - feeForFromPlayer;
  const toNet = offer.offeredCrystals - offer.requestedCrystals - feeForToPlayer;
  fromPlayer.crystalBalance += fromNet;
  toPlayer.crystalBalance += toNet;

  db.crystalTransactions.push({ id: db.nextId(), playerId: fromPlayer.id, amount: fromNet, source: 'trade', createdAt: Date.now() });
  db.crystalTransactions.push({ id: db.nextId(), playerId: toPlayer.id, amount: toNet, source: 'trade', createdAt: Date.now() });

  offer.status = 'accepted';
  offer.resolvedAt = Date.now();

  return offer;
}

function declineTradeOffer(tradeId, playerId) {
  const offer = db.tradeOffers.get(tradeId);
  if (!offer) throw new TradeError('NOT_FOUND', 'Trade offer not found');
  if (offer.status !== 'pending') throw new TradeError('NOT_PENDING', 'Trade offer already resolved');
  if (offer.toPlayerId !== playerId && offer.fromPlayerId !== playerId) {
    throw new TradeError('NOT_PARTICIPANT', 'Not a participant in this trade');
  }
  offer.status = 'declined';
  offer.resolvedAt = Date.now();
  return offer;
}

function listTradesForPlayer(playerId) {
  return [...db.tradeOffers.values()].filter((o) => o.fromPlayerId === playerId || o.toPlayerId === playerId);
}

module.exports = {
  createTradeOffer,
  acceptTradeOffer,
  declineTradeOffer,
  listTradesForPlayer,
  isTradeEligible,
  TradeError,
};
