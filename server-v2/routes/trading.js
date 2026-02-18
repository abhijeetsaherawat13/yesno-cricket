import { Router } from 'express';
import { tradingService, userService } from '../services/index.js';
import { requireAuth } from './auth.js';
import { log } from '../lib/logger.js';
import { MARKET_TYPES } from '../lib/constants.js';

const router = Router();

// POST /api/trade or POST /api/trades/orders
// Execute a trade (buy position)
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { matchKey, direction, quantity, marketId = MARKET_TYPES.MATCH_WINNER } = req.body;

    // Validate inputs
    if (!matchKey) {
      return res.status(400).json({
        success: false,
        error: 'matchKey is required'
      });
    }

    if (!direction || !['A', 'B'].includes(direction)) {
      return res.status(400).json({
        success: false,
        error: 'direction must be "A" or "B"'
      });
    }

    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      return res.status(400).json({
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
      qty
    );

    log.info(`[Trading] Trade executed: user=${userId}, match=${matchKey}, dir=${direction}, qty=${qty}`);

    res.json({
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
    log.error('[Trading] POST / error:', err.message);

    // Return specific error messages for known error types
    if (err.message.includes('Insufficient balance')) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    if (err.message.includes('Market not found')) {
      return res.status(404).json({
        success: false,
        error: err.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to execute trade'
    });
  }
});

// POST /api/trade/close
// Close a position (sell) - body contains positionId
router.post('/close', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { positionId, quantity } = req.body;

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

    const qty = quantity ? parseInt(quantity, 10) : null;
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
    const { quantity } = req.body;

    // Parse positionId from URL
    const posId = parseInt(positionId, 10);
    if (isNaN(posId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid positionId'
      });
    }

    const qty = quantity ? parseInt(quantity, 10) : null;
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
// Alias for POST /api/trade (frontend-compatible)
router.post('/orders', requireAuth, async (req, res, next) => {
  // Forward to the main trade handler by changing the path
  req.url = '/';
  router.handle(req, res, next);
});

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
