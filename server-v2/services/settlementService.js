import * as db from '../db/index.js';
import * as state from '../lib/state.js';
import { log } from '../lib/logger.js';
import { POSITION_STATUS, TRANSACTION_TYPES } from '../lib/constants.js';
import * as userService from './userService.js';
import * as tradingService from './tradingService.js';

// Settle a match with a winner
export async function settleMatch(matchKey, winner, adminUserId) {
  // Validate winner
  if (!['A', 'B'].includes(winner)) {
    throw new Error('Winner must be "A" or "B"');
  }

  // Check if already settled
  const existingSettlement = await db.getSettlement(matchKey);
  if (existingSettlement) {
    throw new Error(`Match ${matchKey} already settled. Winner was: ${existingSettlement.winner}`);
  }

  log.info(`[SettlementService] Starting settlement for ${matchKey}, winner: ${winner}`);

  // Get all open positions for this match
  const positions = await tradingService.getMatchPositions(matchKey);
  log.info(`[SettlementService] Found ${positions.length} open positions`);

  const results = {
    matchKey,
    winner,
    totalPositions: positions.length,
    winners: [],
    losers: [],
    totalPayout: 0
  };

  // Process each position
  for (const position of positions) {
    try {
      const isWinner = position.direction === winner;
      const status = isWinner ? POSITION_STATUS.WON : POSITION_STATUS.LOST;

      // Calculate payout
      // Winners get: quantity * 1 (they bought at avgPrice, win pays 100%)
      // Losers get: nothing (they already paid their stake)
      const payout = isWinner ? position.quantity : 0;

      // Update position status in DB
      await db.closePosition(position.dbId, status);

      // Remove from memory
      state.removePosition(position.dbId);

      if (isWinner) {
        // Winner: their shares are now worth $1.00 each
        // Deduct the cost (clears held), then add the payout
        const costBasis = position.quantity * position.avgPrice;
        const profit = payout - costBasis;

        // Deduct cost basis (this also clears held balance)
        await userService.deductFromBalance(
          position.userId,
          costBasis,
          TRANSACTION_TYPES.SETTLEMENT,
          String(position.dbId),
          `Settlement: ${position.quantity} shares @ ${(position.avgPrice * 100).toFixed(0)}% cost`
        );

        // Credit the full payout (shares worth $1.00 each)
        await userService.addToBalance(
          position.userId,
          payout,
          TRANSACTION_TYPES.SETTLEMENT,
          `Won ${position.quantity} on ${matchKey} (${position.direction}) - profit: $${profit.toFixed(2)}`
        );

        results.winners.push({
          userId: position.userId,
          positionId: position.dbId,
          direction: position.direction,
          quantity: position.quantity,
          costBasis,
          payout,
          profit
        });

        results.totalPayout += payout;
        log.info(`[SettlementService] Winner: user ${position.userId}, cost: ${costBasis}, payout: ${payout}, profit: ${profit}`);
      } else {
        // Loser: their shares are now worth $0.00
        // Deduct the cost (their stake is lost)
        const loss = position.quantity * position.avgPrice;

        await userService.deductFromBalance(
          position.userId,
          loss,
          TRANSACTION_TYPES.SETTLEMENT,
          String(position.dbId),
          `Lost ${position.quantity} on ${matchKey} (bet ${position.direction}, winner: ${winner})`
        );

        results.losers.push({
          userId: position.userId,
          positionId: position.dbId,
          direction: position.direction,
          quantity: position.quantity,
          loss
        });

        log.info(`[SettlementService] Loser: user ${position.userId}, lost: ${loss}`);
      }
    } catch (err) {
      log.error(`[SettlementService] Error processing position ${position.dbId}:`, err.message);
    }
  }

  // Record settlement
  await db.createSettlement(matchKey, winner, adminUserId);

  log.info(`[SettlementService] Settlement complete for ${matchKey}. Winners: ${results.winners.length}, Losers: ${results.losers.length}, Total payout: ${results.totalPayout}`);

  return results;
}

// Get settlement status for a match
export async function getSettlement(matchKey) {
  return db.getSettlement(matchKey);
}

// Check if a match is settled
export async function isMatchSettled(matchKey) {
  return db.isMatchSettled(matchKey);
}

// Get all settlements
export async function getAllSettlements() {
  return db.getAllSettlements();
}

export default {
  settleMatch,
  getSettlement,
  isMatchSettled,
  getAllSettlements
};
