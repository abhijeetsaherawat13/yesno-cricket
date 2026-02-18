import * as db from '../db/index.js';
import * as state from '../lib/state.js';
import { log } from '../lib/logger.js';
import { POSITION_STATUS, TRANSACTION_TYPES, MARKET_TYPES } from '../lib/constants.js';
import * as userService from './userService.js';
import * as marketService from './marketService.js';

// Execute a trade (buy position)
export async function executeTrade(userId, matchKey, marketId, direction, quantity) {
  // Validate inputs
  if (!userId || !matchKey || !direction || !quantity) {
    throw new Error('Missing required trade parameters');
  }

  if (!['A', 'B'].includes(direction)) {
    throw new Error('Direction must be "A" or "B"');
  }

  if (quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('Quantity must be a positive integer');
  }

  // Get market prices
  const prices = marketService.getMarketPrices(matchKey, marketId);
  if (!prices) {
    throw new Error('Market not found or not available');
  }

  const price = direction === 'A' ? prices.priceA : prices.priceB;
  const cost = quantity * (price / 100);

  // Get or create user
  const user = await userService.ensureUser(userId);

  // Check available balance
  const available = user.balance - user.heldBalance;
  if (cost > available) {
    throw new Error(`Insufficient balance. Available: ${available.toFixed(2)}, Required: ${cost.toFixed(2)}`);
  }

  // Check for existing position in same market/direction
  const userPositionIds = state.getUserPositionIds(userId);
  let existingPosition = null;

  for (const posId of userPositionIds) {
    const pos = state.getPosition(posId);
    if (pos && pos.matchKey === matchKey && pos.marketId === marketId &&
        pos.direction === direction && pos.status === POSITION_STATUS.OPEN) {
      existingPosition = pos;
      break;
    }
  }

  let position;

  if (existingPosition) {
    // Update existing position (average in)
    const totalQuantity = existingPosition.quantity + quantity;
    const totalCost = existingPosition.quantity * existingPosition.avgPrice + quantity * (price / 100);
    const newAvgPrice = totalCost / totalQuantity;

    // Update DB
    await db.updatePositionForTrade(existingPosition.dbId, totalQuantity, newAvgPrice);

    // Update memory
    position = {
      ...existingPosition,
      quantity: totalQuantity,
      avgPrice: newAvgPrice
    };
    state.addPosition(position);

    log.info(`[TradingService] Updated position ${existingPosition.dbId}: +${quantity} @ ${price}`);
  } else {
    // Create new position
    const dbPosition = await db.createPosition({
      userId,
      matchKey,
      marketId,
      direction,
      quantity,
      avgPrice: price / 100
    });

    position = {
      id: dbPosition.id,
      dbId: dbPosition.id,
      userId,
      matchKey,
      marketId,
      direction,
      quantity,
      avgPrice: price / 100,
      status: POSITION_STATUS.OPEN,
      createdAt: dbPosition.created_at
    };

    state.addPosition(position);
    log.info(`[TradingService] Created position ${dbPosition.id}: ${direction} ${quantity} @ ${price}`);
  }

  // Update user balance (hold the cost)
  await userService.holdBalance(userId, cost);

  // Record transaction
  await db.createTransaction({
    userId,
    type: TRANSACTION_TYPES.TRADE,
    amount: -cost,
    balanceAfter: (await userService.getUser(userId)).balance,
    referenceId: String(position.dbId),
    description: `Buy ${quantity} ${direction} @ ${price}% on ${matchKey}`
  });

  return {
    positionId: position.dbId,
    matchKey,
    marketId,
    direction,
    quantity: position.quantity,
    avgPrice: position.avgPrice,
    cost,
    newBalance: (await userService.getUser(userId)).balance
  };
}

// Close a position (sell)
export async function closePosition(userId, positionId, quantity = null) {
  // Find position in memory first
  let position = state.getPosition(positionId);

  // If not in memory, check DB
  if (!position) {
    const dbPosition = await db.getPosition(positionId);
    if (!dbPosition) {
      throw new Error('Position not found');
    }

    position = {
      id: dbPosition.id,
      dbId: dbPosition.id,
      userId: dbPosition.user_id,
      matchKey: dbPosition.match_key,
      marketId: dbPosition.market_id,
      direction: dbPosition.direction,
      quantity: dbPosition.quantity,
      avgPrice: parseFloat(dbPosition.avg_price),
      status: dbPosition.status,
      createdAt: dbPosition.created_at
    };
  }

  // Validate ownership
  if (position.userId !== userId) {
    throw new Error('Position does not belong to user');
  }

  // Validate status
  if (position.status !== POSITION_STATUS.OPEN) {
    throw new Error('Position is not open');
  }

  // Determine quantity to close
  const closeQuantity = quantity || position.quantity;
  if (closeQuantity > position.quantity) {
    throw new Error(`Cannot close more than owned. Owned: ${position.quantity}, Requested: ${closeQuantity}`);
  }

  // Get current market price
  const prices = marketService.getMarketPrices(position.matchKey, position.marketId);
  if (!prices) {
    throw new Error('Market not found or not available');
  }

  const currentPrice = position.direction === 'A' ? prices.priceA : prices.priceB;
  const closeValue = closeQuantity * (currentPrice / 100);
  const costBasis = closeQuantity * position.avgPrice;
  const pnl = closeValue - costBasis;

  if (closeQuantity === position.quantity) {
    // Full close
    await db.closePosition(position.dbId, POSITION_STATUS.CLOSED);
    state.removePosition(position.dbId);
    log.info(`[TradingService] Closed position ${position.dbId}: ${closeQuantity} @ ${currentPrice} (PnL: ${pnl.toFixed(2)})`);
  } else {
    // Partial close
    const remainingQuantity = position.quantity - closeQuantity;
    await db.updatePositionForTrade(position.dbId, remainingQuantity, position.avgPrice);

    const updatedPosition = {
      ...position,
      quantity: remainingQuantity
    };
    state.addPosition(updatedPosition);

    log.info(`[TradingService] Partial close ${position.dbId}: ${closeQuantity} @ ${currentPrice}, remaining: ${remainingQuantity}`);
  }

  // Release held balance and apply PnL
  // The costBasis was held when buying, so we release it back
  // Then we apply only the profit/loss (not the full closeValue)
  await userService.releaseHeldBalance(userId, costBasis);

  // Only record a transaction if there's a PnL
  if (pnl !== 0) {
    await userService.addToBalance(userId, pnl, TRANSACTION_TYPES.TRADE, `Close ${closeQuantity} ${position.direction} @ ${currentPrice}% (PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})`);
  } else {
    // Even if no PnL, record the close transaction
    await db.createTransaction({
      userId,
      type: TRANSACTION_TYPES.TRADE,
      amount: 0,
      balanceAfter: (await userService.getUser(userId)).balance,
      description: `Close ${closeQuantity} ${position.direction} @ ${currentPrice}% (break-even)`
    });
  }

  return {
    positionId: position.dbId,
    closedQuantity: closeQuantity,
    closePrice: currentPrice,
    closeValue,
    pnl,
    newBalance: (await userService.getUser(userId)).balance
  };
}

// Get user's open positions
export async function getUserPositions(userId) {
  // Get from memory
  const positionIds = state.getUserPositionIds(userId);
  const positions = [];

  for (const posId of positionIds) {
    const pos = state.getPosition(posId);
    if (pos && pos.status === POSITION_STATUS.OPEN) {
      // Get current market price for unrealized PnL
      const prices = marketService.getMarketPrices(pos.matchKey, pos.marketId);
      const currentPrice = prices ? (pos.direction === 'A' ? prices.priceA : prices.priceB) : null;

      positions.push({
        ...pos,
        currentPrice,
        unrealizedPnl: currentPrice
          ? (pos.quantity * (currentPrice / 100)) - (pos.quantity * pos.avgPrice)
          : null
      });
    }
  }

  // If no positions in memory, check DB
  if (positions.length === 0) {
    const dbPositions = await db.getUserPositions(userId, POSITION_STATUS.OPEN);

    for (const dbPos of dbPositions) {
      const pos = {
        id: dbPos.id,
        dbId: dbPos.id,
        userId: dbPos.user_id,
        matchKey: dbPos.match_key,
        marketId: dbPos.market_id,
        direction: dbPos.direction,
        quantity: dbPos.quantity,
        avgPrice: parseFloat(dbPos.avg_price),
        status: dbPos.status,
        createdAt: dbPos.created_at
      };

      state.addPosition(pos);

      const prices = marketService.getMarketPrices(pos.matchKey, pos.marketId);
      const currentPrice = prices ? (pos.direction === 'A' ? prices.priceA : prices.priceB) : null;

      positions.push({
        ...pos,
        currentPrice,
        unrealizedPnl: currentPrice
          ? (pos.quantity * (currentPrice / 100)) - (pos.quantity * pos.avgPrice)
          : null
      });
    }
  }

  return positions;
}

// Get positions for a specific match (for settlement)
export async function getMatchPositions(matchKey) {
  const dbPositions = await db.getMatchPositions(matchKey, POSITION_STATUS.OPEN);

  return dbPositions.map(dbPos => ({
    id: dbPos.id,
    dbId: dbPos.id,
    userId: dbPos.user_id,
    matchKey: dbPos.match_key,
    marketId: dbPos.market_id,
    direction: dbPos.direction,
    quantity: dbPos.quantity,
    avgPrice: parseFloat(dbPos.avg_price),
    status: dbPos.status,
    createdAt: dbPos.created_at
  }));
}

export default {
  executeTrade,
  closePosition,
  getUserPositions,
  getMatchPositions
};
