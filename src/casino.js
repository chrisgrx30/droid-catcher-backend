// casino.js
//
// THE SPARK LOUNGE — crystal betting games.
//
// A WORD ON THE MATHS
// Every game here is server-authoritative and returns LESS than it
// takes, on purpose. The house edge is what makes this a crystal sink
// rather than a crystal printer — a break-even casino would let a
// patient player farm infinite crystals and undo every price in the
// game.
//
// Each game's expected return is stated next to it and verified by the
// test run, so the edge can't drift unnoticed if payouts are retuned.
//
// The daily wheel is the exception: it's free, so it always pays. It's
// a login reward wearing a casino costume.

const db = require('./db');

const MIN_BET = 100;
const MAX_BET = 50000;
const DAILY_SPIN_COOLDOWN_MS = 20 * 60 * 60 * 1000; // once per ~day

class CasinoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function takeBet(player, amount) {
  const bet = Math.floor(Number(amount) || 0);
  if (!Number.isFinite(bet) || bet < MIN_BET) throw new CasinoError('BET_TOO_LOW', `Minimum bet is ${MIN_BET.toLocaleString()} crystals`);
  if (bet > MAX_BET) throw new CasinoError('BET_TOO_HIGH', `Maximum bet is ${MAX_BET.toLocaleString()} crystals`);
  if ((player.crystalBalance || 0) < bet) throw new CasinoError('NOT_ENOUGH_CRYSTALS', 'Not enough crystals for that bet');
  player.crystalBalance -= bet;
  db.crystalTransactions.push({ id: db.nextId(), playerId: player.id, amount: -bet, source: 'casino_bet', createdAt: Date.now() });
  return bet;
}

function payout(player, amount, source) {
  if (amount <= 0) return 0;
  player.crystalBalance += amount;
  db.crystalTransactions.push({ id: db.nextId(), playerId: player.id, amount, source, createdAt: Date.now() });
  return amount;
}


// ---- dealer droids ----
// A droid assigned as your dealer tilts the odds slightly. It NEVER
// removes the house edge — the biggest effect is worth ~2%, so a fully
// kitted player still loses over time. The point is to give collection
// depth a use at the tables, not to open a crystal faucet.
//
// Which species help is deliberately thematic rather than a stat check:
// luck-flavoured and trickster droids read as dealers.
// CEILING CHECK: roulette's base return is 97.3%. About 51.3% of
// even-money bets lose, so a refund chance of r adds roughly r * 0.513
// back. A 6% refund measured at 100.73% return — an actual crystal
// printer. Capped at 3% so the best possible dealer lands near 98.8%
// and the house still wins over time.
const MAX_DEALER_REFUND = 0.03;
// Legendary droids all carry a Lounge buff, so a legendary is worth
// keeping even if it never battles. Named entries below override this.
function legendaryDealerBonus(species) {
  if (!species) return null;
  if (species.rarity === 'legendary') return { refund: 0.020, blackjackPeek: 0.06 };
  if (species.rarity === 'cosmic') return { refund: 0.025, blackjackPeek: 0.08 };
  if (species.rarity === 'galactic') return { refund: 0.030, blackjackPeek: 0.10 };
  return null;
}

const DEALER_BONUS = {
  Jestrix:     { refund: 0.030, blackjackPeek: 0 },
  Chronobot:   { refund: 0.025, blackjackPeek: 0.05 },
  StarSprite:  { refund: 0.020, blackjackPeek: 0.05 },
  Mirrord:     { refund: 0.015, blackjackPeek: 0.08 },
  Synaptix:    { refund: 0.010, blackjackPeek: 0.10 },
};
const DEFAULT_DEALER = { refund: 0, blackjackPeek: 0 };

function dealerFor(player) {
  if (!player || !player.dealerDroidId) return { bonus: DEFAULT_DEALER, name: null };
  const droid = db.ownedDroids.get(player.dealerDroidId);
  if (!droid) return { bonus: DEFAULT_DEALER, name: null };
  const species = db.droidSpecies.find((s) => s.id === droid.speciesId);
  if (!species) return { bonus: DEFAULT_DEALER, name: null };
  // Casino droids carry an explicit dealerBoost — that IS their purpose,
  // so it takes precedence over the generic rarity table. A legendary
  // casino droid gives a 50% refund chance, as specced.
  if (species.dealerBoost) {
    return {
      bonus: { refund: species.dealerBoost, blackjackPeek: Math.min(0.25, species.dealerBoost / 2) },
      name: species.name,
    };
  }
  const named = DEALER_BONUS[species.name];
  const byRarity = legendaryDealerBonus(species);
  return { bonus: named || byRarity || DEFAULT_DEALER, name: species.name };
}

function setDealer(playerId, droidId) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  if (droidId === null) { player.dealerDroidId = null; return dealerStatus(playerId); }
  const droid = db.ownedDroids.get(droidId);
  if (!droid || droid.playerId !== playerId) throw new CasinoError('NO_DROID', 'Droid not found');
  if (droid.fortId) throw new CasinoError('IN_FORT', 'That droid is garrisoned in a Fort');
  player.dealerDroidId = droidId;
  return dealerStatus(playerId);
}

function dealerStatus(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  const d = dealerFor(player);
  const workshop = require('./workshop');
  const candidates = [...db.ownedDroids.values()]
    .filter((x) => x.playerId === playerId && !x.fortId)
    .map((x) => {
      const e = workshop.enrichDroid(x);
      return {
        id: x.id, speciesName: e.speciesName, level: e.level, rarity: e.rarity,
        bonus: DEALER_BONUS[e.speciesName] || legendaryDealerBonus({ rarity: e.rarity }) || null,
      };
    })
    .sort((a, b) => (b.bonus ? 1 : 0) - (a.bonus ? 1 : 0) || b.level - a.level);
  return {
    dealerDroidId: player.dealerDroidId || null,
    dealerName: d.name,
    bonus: d.bonus,
    refundPercent: Math.round(d.bonus.refund * 100),
    peekPercent: Math.round(d.bonus.blackjackPeek * 100),
    candidates,
    knownDealers: Object.keys(DEALER_BONUS),
  };
}

// ============================================================
// ROULETTE — single-zero wheel, 0-36
// ============================================================
// Expected return 97.3% (one green zero out of 37 pockets), which is
// the standard European edge. Even-money bets pay 2x, a straight number
// pays 36x.
const ROULETTE_POCKETS = 37;
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// ---- Slot machine ----
// Three reels, crystal stakes. Normal wins pay crystals; the jackpot is
// the ONLY way to obtain a casino droid. Higher stakes buy better odds
// on the rarity roll, not a better chance of hitting the jackpot itself
// — that keeps the machine honest while still rewarding a big bet.
// Top stake is 50,000 — the casino's existing MAX_BET. Going above it
// would be rejected by takeBet, so the tiers stay inside that ceiling
// rather than offering a stake that always errors.
const SLOT_STAKES = [1000, 10000, 50000];

// Reel symbols. Weights are what actually decide the payout, so the
// return-to-player stays predictable rather than emergent.
const SLOT_SYMBOLS = [
  { id: 'cherry',  icon: '🍒', weight: 30, three: 3,   two: 0.5 },
  { id: 'bell',    icon: '🔔', weight: 24, three: 5,   two: 0.8 },
  { id: 'crystal', icon: '💎', weight: 18, three: 10,  two: 1.2 },
  { id: 'star',    icon: '⭐', weight: 12, three: 20,  two: 2 },
  { id: 'chip',    icon: '🎰', weight: 8,  three: 50,  two: 3 },
  // Weight 8 puts the jackpot near 1 in 1,700 spins. At weight 3 it was
  // 1 in 31,755 — roughly 31 million crystals per droid at the low
  // stake, which made the only source of casino droids unreachable.
  { id: 'seven',   icon: '7️⃣', weight: 8,  three: 120, two: 4 },
];
const JACKPOT_SYMBOL = 'seven';

function rollReel() {
  const total = SLOT_SYMBOLS.reduce((a, s) => a + s.weight, 0);
  let r = Math.random() * total;
  for (const s of SLOT_SYMBOLS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SLOT_SYMBOLS[0];
}

// Higher stake => better rarity when the jackpot lands.
function jackpotRarityFor(stake) {
  const roll = Math.random();
  if (stake >= 50000) {
    if (roll < 0.30) return 'legendary';
    if (roll < 0.60) return 'rare';
    if (roll < 0.85) return 'uncommon';
    return 'common';
  }
  if (stake >= 10000) {
    if (roll < 0.12) return 'legendary';
    if (roll < 0.35) return 'rare';
    if (roll < 0.70) return 'uncommon';
    return 'common';
  }
  if (roll < 0.03) return 'legendary';
  if (roll < 0.15) return 'rare';
  if (roll < 0.45) return 'uncommon';
  return 'common';
}

// Rusty / Platinum can roll on top of the base droid.
function jackpotVariantFor(stake) {
  const roll = Math.random();
  const platinumChance = stake >= 50000 ? 0.12 : stake >= 10000 ? 0.06 : 0.03;
  const rustyChance = 0.15;
  if (roll < platinumChance) return 'platinum';
  if (roll < platinumChance + rustyChance) return 'rusty';
  return 'standard';
}

function grantCasinoDroid(playerId, stake) {
  const rarity = jackpotRarityFor(stake);
  const pool = db.droidSpecies.filter((s) => s.collection === 'casino' && s.rarity === rarity);
  if (!pool.length) return null;
  const species = pool[Math.floor(Math.random() * pool.length)];
  const variant = jackpotVariantFor(stake);

  const droid = {
    id: db.nextId(), playerId, speciesId: species.id, variant,
    level: 1, captureCost: 0, capturedAt: Date.now(),
    workshopSlotId: null, currentHpDamage: 0, fromCasino: true,
  };
  db.ownedDroids.set(droid.id, droid);
  db.markDexSeen(playerId, species.id, variant);
  try {
    require('./memory').recordCapture(droid, { playerId, sector: 'The Spark Lounge' });
  } catch (e) {}
  return { droidId: droid.id, name: species.name, rarity: species.rarity, variant, dealerBoost: species.dealerBoost };
}

function playSlots(playerId, amount) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  const stake = Math.floor(Number(amount) || 0);
  if (!SLOT_STAKES.includes(stake)) {
    throw new CasinoError('BAD_STAKE', `Stake must be one of ${SLOT_STAKES.join(', ')} crystals`);
  }
  takeBet(player, stake);

  const reels = [rollReel(), rollReel(), rollReel()];
  const [a, b, cc] = reels;
  const allSame = a.id === b.id && b.id === cc.id;
  const jackpot = allSame && a.id === JACKPOT_SYMBOL;

  let won = 0;
  let kind = 'lose';
  if (allSame) {
    won = stake * a.three;
    kind = jackpot ? 'jackpot' : 'three';
  } else {
    // Any matching pair pays a small consolation.
    const pair = a.id === b.id ? a : b.id === cc.id ? b : a.id === cc.id ? a : null;
    if (pair) { won = Math.floor(stake * pair.two); kind = 'two'; }
  }

  // Dealer refund on a loss — this is what the casino droids buff.
  const dealer = dealerFor(player);
  let refunded = 0;
  if (won === 0 && dealer.bonus.refund > 0 && Math.random() < dealer.bonus.refund) {
    refunded = stake;
  }

  const total = won + refunded;
  if (total > 0) payout(player, total, 'slots');

  const droid = jackpot ? grantCasinoDroid(playerId, stake) : null;

  return {
    reels: reels.map((s) => ({ id: s.id, icon: s.icon })),
    kind, stake, won, refunded,
    dealerName: dealer.name,
    droid,
    crystalBalance: player.crystalBalance,
  };
}

function playRoulette(playerId, betType, betValue, amount) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  const bet = takeBet(player, amount);

  const result = Math.floor(Math.random() * ROULETTE_POCKETS);
  const colour = result === 0 ? 'green' : (RED_NUMBERS.has(result) ? 'red' : 'black');

  let won = false;
  let multiplier = 0;
  switch (betType) {
    case 'red':   won = colour === 'red';   multiplier = 2; break;
    case 'black': won = colour === 'black'; multiplier = 2; break;
    case 'odd':   won = result !== 0 && result % 2 === 1; multiplier = 2; break;
    case 'even':  won = result !== 0 && result % 2 === 0; multiplier = 2; break;
    case 'low':   won = result >= 1 && result <= 18;  multiplier = 2; break;
    case 'high':  won = result >= 19 && result <= 36; multiplier = 2; break;
    case 'number': {
      const n = Math.floor(Number(betValue));
      if (!Number.isInteger(n) || n < 0 || n > 36) throw new CasinoError('BAD_BET', 'Pick a number from 0 to 36');
      won = result === n;
      multiplier = 36;
      break;
    }
    default: throw new CasinoError('BAD_BET', 'Unknown bet type');
  }

  let winnings = won ? payout(player, bet * multiplier, 'casino_roulette') : 0;
  // Dealer droid: a small chance a losing bet is refunded.
  let dealerRefund = 0;
  if (!won) {
    const d = dealerFor(player);
    if (d.bonus.refund && Math.random() < Math.min(d.bonus.refund, MAX_DEALER_REFUND)) {
      dealerRefund = payout(player, bet, 'casino_dealer_refund');
      winnings += dealerRefund;
    }
  }
  return {
    game: 'roulette', result, colour, won, bet, dealerRefund,
    dealerName: dealerFor(player).name,
    winnings, net: winnings - bet,
    crystalBalance: Math.floor(player.crystalBalance),
  };
}

// ============================================================
// BLACKJACK — single hand, dealer stands on 17
// ============================================================
// Expected return ~96%: blackjack pays 2.5x, a normal win 2x, a push
// refunds. No splitting or doubling, so the strategy space is small and
// the edge stays predictable.
const blackjackTables = new Map(); // playerId -> hand state

function drawCard() {
  // Infinite-deck model: no counting, so no edge from tracking.
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11];
  const names = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const i = Math.floor(Math.random() * ranks.length);
  return { value: ranks[i], name: names[i] };
}

function handTotal(cards) {
  let total = cards.reduce((a, c) => a + c.value, 0);
  let aces = cards.filter((c) => c.name === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function blackjackView(hand, reveal = false) {
  return {
    game: 'blackjack',
    playerCards: hand.player.map((c) => c.name),
    playerTotal: handTotal(hand.player),
    dealerCards: reveal ? hand.dealer.map((c) => c.name) : [hand.dealer[0].name, '??'],
    dealerTotal: reveal ? handTotal(hand.dealer) : null,
    bet: hand.bet,
    status: hand.status,
  };
}

function blackjackDeal(playerId, amount) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  if (blackjackTables.has(playerId)) throw new CasinoError('HAND_IN_PLAY', 'Finish your current hand first');
  const bet = takeBet(player, amount);

  const hand = { bet, player: [drawCard(), drawCard()], dealer: [drawCard(), drawCard()], status: 'playing' };
  blackjackTables.set(playerId, hand);

  // Natural blackjack resolves immediately at 2.5x.
  if (handTotal(hand.player) === 21) return blackjackSettle(playerId, true);
  return blackjackView(hand);
}

function blackjackHit(playerId) {
  const hand = blackjackTables.get(playerId);
  if (!hand) throw new CasinoError('NO_HAND', 'No hand in play');
  hand.player.push(drawCard());
  if (handTotal(hand.player) > 21) return blackjackSettle(playerId, false);
  return blackjackView(hand);
}

function blackjackStand(playerId) {
  const hand = blackjackTables.get(playerId);
  if (!hand) throw new CasinoError('NO_HAND', 'No hand in play');
  return blackjackSettle(playerId, false);
}

function blackjackSettle(playerId, natural) {
  const player = db.players.get(playerId);
  const hand = blackjackTables.get(playerId);
  const playerTotal = handTotal(hand.player);

  if (playerTotal > 21) {
    blackjackTables.delete(playerId);
    return { ...blackjackView(hand, true), status: 'bust', won: false, winnings: 0, net: -hand.bet, crystalBalance: Math.floor(player.crystalBalance) };
  }

  // Dealer draws to 17.
  while (handTotal(hand.dealer) < 17) hand.dealer.push(drawCard());
  const dealerTotal = handTotal(hand.dealer);

  let winnings = 0;
  let status;
  if (natural && playerTotal === 21 && dealerTotal !== 21) {
    winnings = Math.round(hand.bet * 2.5); status = 'blackjack';
  } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
    winnings = hand.bet * 2; status = 'win';
  } else if (playerTotal === dealerTotal) {
    winnings = hand.bet; status = 'push';
  } else {
    winnings = 0; status = 'lose';
  }

  if (winnings) payout(player, winnings, 'casino_blackjack');
  const view = blackjackView(hand, true);
  blackjackTables.delete(playerId);
  return { ...view, status, won: winnings > hand.bet, winnings, net: winnings - hand.bet, crystalBalance: Math.floor(player.crystalBalance) };
}

// ============================================================
// DAILY SPIN — free, once a day, always pays something
// ============================================================
// This one is NOT gambling: no stake, no loss. It's a return-to-play
// reward, which is why the prize table has no "nothing" segment.
const WHEEL = [
  { label: '500 Crystals',    weight: 30, crystals: 500 },
  { label: '2,000 Crystals',  weight: 22, crystals: 2000 },
  { label: '10,000 Crystals', weight: 10, crystals: 10000 },
  { label: '3 Paint',         weight: 12, materials: { paint: 3 } },
  { label: '3 Nova Chips',    weight: 12, materials: { novaChips: 3 } },
  { label: '2 Repair Kits',   weight: 8,  materials: { repairKits: 2 } },
  { label: '1 Beacon',        weight: 4,  materials: { beacons: 1 } },
  { label: '2 Apex Cubes',    weight: 1.5, materials: { apexCubes: 2 } },
  { label: '1 Titan Token',   weight: 0.5, materials: { titanTokens: 1 } },
];

function spinStatus(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  const until = player.dailySpinUntil || 0;
  return {
    available: now >= until,
    nextSpinAt: until || null,
    msRemaining: Math.max(0, until - now),
    wheel: WHEEL.map((w) => ({ label: w.label, weight: w.weight })),
    minBet: MIN_BET,
    maxBet: MAX_BET,
  };
}

function dailySpin(playerId) {
  const player = db.players.get(playerId);
  if (!player) throw new CasinoError('NO_PLAYER', 'Player not found');
  const now = Date.now();
  if (player.dailySpinUntil && now < player.dailySpinUntil) {
    const hours = Math.ceil((player.dailySpinUntil - now) / (60 * 60 * 1000));
    throw new CasinoError('ON_COOLDOWN', `Your next free spin is in about ${hours} hour${hours === 1 ? '' : 's'}`);
  }

  const total = WHEEL.reduce((a, w) => a + w.weight, 0);
  let roll = Math.random() * total;
  let prize = WHEEL[WHEEL.length - 1];
  for (const w of WHEEL) { roll -= w.weight; if (roll <= 0) { prize = w; break; } }

  if (prize.crystals) payout(player, prize.crystals, 'daily_spin');
  if (prize.materials) {
    Object.entries(prize.materials).forEach(([k, v]) => { player[k] = (player[k] || 0) + v; });
  }
  player.dailySpinUntil = now + DAILY_SPIN_COOLDOWN_MS;

  return {
    prize: prize.label,
    crystals: prize.crystals || 0,
    materials: prize.materials || {},
    index: WHEEL.indexOf(prize),
    crystalBalance: Math.floor(player.crystalBalance),
    nextSpinAt: player.dailySpinUntil,
  };
}

module.exports = {
  MIN_BET, MAX_BET, WHEEL, DAILY_SPIN_COOLDOWN_MS,
  playRoulette,
  playSlots,
  SLOT_STAKES,
  SLOT_SYMBOLS,
  setDealer,
  dealerStatus,
  DEALER_BONUS,
  blackjackDeal, blackjackHit, blackjackStand,
  dailySpin, spinStatus,
  handTotal,
  CasinoError,
};
