import { Router } from 'express';
import { tradingService, userService, marketService } from '../services/index.js';
import { requireAuth } from './auth.js';
import { log } from '../lib/logger.js';
import { MARKET_TYPES } from '../lib/constants.js';

const router = Router();

// ============================================================================
// Request Normalization Helpers
// Frontend sends different format than server expects, so we normalize here
// ============================================================================

/**
 * Normalize trade request from frontend format to server format
 * Frontend sends: { matchId, side, amount, optionLabel }
 * Server expects: { matchKey, direction, quantity, marketId }
 */
function normalizeTradeRequest(body) {
  // Detect format: frontend has 'side' and 'amount'
  const isFrontendFormat = 'side' in body || 'amount' in body;

  if (!isFrontendFormat) {
    // Legacy format - return as-is
    return {
      matchKey: body.matchKey,
      marketId: body.marketId || MARKET_TYPES.MATCH_WINNER,
      direction: body.direction,
      quantity: parseInt(body.quantity, 10)
    };
  }

  // Frontend format - transform
  const { matchId, matchKey: providedKey, marketId = MARKET_TYPES.MATCH_WINNER, side, amount, optionLabel } = body;

  // 1. Resolve matchKey from matchId or use provided
  const matchKey = providedKey || resolveMatchKey(matchId);
  if (!matchKey) {
    throw new Error(`Match not found for matchId: ${matchId}`);
  }

  // 2. Get market data
  const market = marketService.getMarket(matchKey);
  if (!market) {
    throw new Error(`Market not found: ${matchKey}`);
  }

  const marketData = market.markets?.find(m => m.marketId === marketId) || market;

  // 3. Resolve direction from side + optionLabel
  const direction = resolveDirection(side, optionLabel, marketData);

  // 4. Calculate quantity from amount and price
  const price = direction === 'A' ? marketData.priceA : marketData.priceB;
  const quantity = Math.floor(amount / (price / 100));

  if (quantity <= 0) {
    throw new Error(`Amount too small. Minimum: Rs ${(price / 100).toFixed(2)}`);
  }

  log.info(`[Trading] Normalized request: matchId=${matchId} -> matchKey=${matchKey}, side=${side} -> direction=${direction}, amount=${amount} -> quantity=${quantity}`);

  return { matchKey, marketId, direction, quantity };
}

/**
 * Resolve matchKey from matchId (which might be eventId or index)
 */
function resolveMatchKey(matchId) {
  if (typeof matchId === 'string' && matchId.includes('-')) {
    return matchId; // Already a matchKey
  }

  const allMarkets = marketService.getAllMarkets();

  // Try eventId match first
  const byEventId = allMarkets.find(m =>
    m.eventId == matchId || m.matchKey == matchId
  );
  if (byEventId) return byEventId.matchKey;

  // Try index-based (for mock data, matchId starts at 1)
  const idx = parseInt(matchId, 10);
  if (idx > 0 && idx <= allMarkets.length) {
    return allMarkets[idx - 1]?.matchKey;
  }

  return null;
}

/**
 * Resolve direction ('A' or 'B') from side ('yes'/'no') and optionLabel
 */
function resolveDirection(side, optionLabel, marketData) {
  const label = (optionLabel || '').toLowerCase();
  const labelA = (marketData.labelA || '').toLowerCase();
  const labelB = (marketData.labelB || '').toLowerCase();

  // Match option to team
  const isTeamA = label === labelA || label.includes(labelA) || labelA.includes(label);

  // yes on A = A, no on A = B, yes on B = B, no on B = A
  if (side === 'yes') {
    return isTeamA ? 'A' : 'B';
  } else {
    return isTeamA ? 'B' : 'A';
  }
}

// Shared handler for executing trades
async function handleExecuteTrade(req, res) {
  try {
    const userId = req.userId;

    log.info(`[Trading] Received trade request: userId=${userId}, body=${JSON.stringify(req.body)}`);

    // Normalize request to internal format (handles frontend format conversion)
    let normalized;
    try {
      normalized = normalizeTradeRequest(req.body);
    } catch (err) {
      log.warn(`[Trading] Normalization failed: ${err.message}`);
      return res.status(400).json({
        ok: false,
        success: false,
        error: err.message
      });
    }

    const { matchKey, marketId, direction, quantity } = normalized;

    // Validate normalized values
    if (!matchKey || !direction || !['A', 'B'].includes(direction)) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Invalid trade parameters'
      });
    }

    if (!quantity || quantity <= 0 || isNaN(quantity)) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'quantity must be a positive integer'
      });
    }

    // Execute trade
    const result = await tradingService.executeTrade(
      userId,
      matchKey,
      marketId,
      direction,
      quantity
    );

    log.info(`[Trading] Trade executed: user=${userId}, match=${matchKey}, dir=${direction}, qty=${quantity}`);

    // Get match info for response
    const match = marketService.getMarket(matchKey);
    const marketData = match?.markets?.find(m => m.marketId === marketId) || {};
    const marketTitle = marketData.name || 'Match Winner';
    const optionLabel = direction === 'A' ? (marketData.labelA || 'A') : (marketData.labelB || 'B');

    // Return format expected by frontend (backend.ts:542-547)
    res.json({
      ok: true,
      order: {
        position: {
          id: result.positionId,
          matchId: match?.eventId || matchKey,
          matchKey: result.matchKey,
          marketId: result.marketId,
          marketTitle: marketTitle,
          optionLabel: optionLabel,
          side: direction === 'A' ? 'yes' : 'no',
          shares: result.quantity,
          avgPrice: result.avgPrice,
          stake: result.cost,
          isLive: match?.isLive ?? true,
          openedAt: new Date().toISOString()
        },
        balance: result.newBalance
      },
      // Also include legacy format for backwards compatibility
      success: true,
      trade: {
        positionId: result.positionId,
        matchKey: result.matchKey,
        marketId: result.marketId,
        direction: result.direction,
        quantity: result.quantity,
        avgPrice: result.avgPrice,
        cost: result.cost
      },
      newBalance: result.newBalance
    });
  } catch (err) {
    log.error('[Trading] Execute trade error:', err.message);

    // Return specific error messages for known error types
    if (err.message.includes('Insufficient balance')) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: err.message
      });
    }

    if (err.message.includes('Market not found')) {
      return res.status(404).json({
        ok: false,
        success: false,
        error: err.message
      });
    }

    res.status(500).json({
      ok: false,
      success: false,
      error: 'Failed to execute trade'
    });
  }
}

// POST /api/trade
// Execute a trade (buy position) - legacy endpoint
router.post('/', requireAuth, handleExecuteTrade);

// POST /api/trade/close
// Close a position (sell) - body contains positionId
router.post('/close', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { positionId, quantity, shares } = req.body; // Accept both 'quantity' and 'shares'

    if (!positionId) {
      return res.status(400).json({
        success: false,
        error: 'positionId is required'
      });
    }

    // Parse positionId (can be string or number)
    const posId = parseInt(positionId, 10);
    if (isNaN(posId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid positionId'
      });
    }

    const rawQty = quantity ?? shares; // Accept either field name
    const qty = rawQty ? parseInt(rawQty, 10) : null;
    if (qty !== null && (isNaN(qty) || qty <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'quantity must be a positive integer'
      });
    }

    // Close position
    const result = await tradingService.closePosition(userId, posId, qty);

    log.info(`[Trading] Position closed: user=${userId}, posId=${posId}, qty=${result.closedQuantity}`);

    res.json({
      success: true,
      close: {
        positionId: result.positionId,
        closedQuantity: result.closedQuantity,
        closePrice: result.closePrice,
        closeValue: result.closeValue,
        pnl: result.pnl
      },
      newBalance: result.newBalance
    });
  } catch (err) {
    log.error('[Trading] POST /close error:', err.message);

    if (err.message.includes('Position not found')) {
      return res.status(404).json({
        success: false,
        error: err.message
      });
    }

    if (err.message.includes('does not belong to user')) {
      return res.status(403).json({
        success: false,
        error: err.message
      });
    }

    if (err.message.includes('not open') || err.message.includes('Cannot close more')) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to close position'
    });
  }
});

// POST /api/trades/positions/:positionId/close
// Close a position (sell) - positionId in URL (frontend-compatible)
router.post('/positions/:positionId/close', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { positionId } = req.params;
    const { quantity, shares } = req.body; // Accept both 'quantity' and 'shares'

    log.info(`[Trading] Close position request: userId=${userId}, positionId=${positionId}, body=${JSON.stringify(req.body)}`);

    // Parse positionId from URL
    const posId = parseInt(positionId, 10);
    if (isNaN(posId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid positionId'
      });
    }

    const rawQty = quantity ?? shares; // Accept either field name
    const qty = rawQty ? parseInt(rawQty, 10) : null;
    if (qty !== null && (isNaN(qty) || qty <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'quantity must be a positive integer'
      });
    }

    // Close position
    const result = await tradingService.closePosition(userId, posId, qty);

    log.info(`[Trading] Position closed: user=${userId}, posId=${posId}, qty=${result.closedQuantity}`);

    res.json({
      success: true,
      close: {
        positionId: result.positionId,
        closedQuantity: result.closedQuantity,
        closePrice: result.closePrice,
        closeValue: result.closeValue,
        pnl: result.pnl
      },
      newBalance: result.newBalance
    });
  } catch (err) {
    log.error('[Trading] POST /positions/:positionId/close error:', err.message);

    if (err.message.includes('Position not found')) {
      return res.status(404).json({
        success: false,
        error: err.message
      });
    }

    if (err.message.includes('does not belong to user')) {
      return res.status(403).json({
        success: false,
        error: err.message
      });
    }

    if (err.message.includes('not open') || err.message.includes('Cannot close more')) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to close position'
    });
  }
});

// POST /api/trades/orders
// Execute a trade (buy position) - frontend endpoint
router.post('/orders', requireAuth, handleExecuteTrade);

// GET /api/positions
// Get user's positions
router.get('/positions', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const positions = await tradingService.getUserPositions(userId);

    res.json({
      success: true,
      positions: positions.map(pos => ({
        id: pos.dbId || pos.id,
        matchKey: pos.matchKey,
        marketId: pos.marketId,
        direction: pos.direction,
        quantity: pos.quantity,
        avgPrice: pos.avgPrice,
        currentPrice: pos.currentPrice,
        unrealizedPnl: pos.unrealizedPnl,
        status: pos.status,
        createdAt: pos.createdAt
      }))
    });
  } catch (err) {
    log.error('[Trading] GET /positions error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch positions'
    });
  }
});

export default router;
