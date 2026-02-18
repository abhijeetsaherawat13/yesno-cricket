import { Router } from 'express';
import { userService, tradingService } from '../services/index.js';
import { requireAuth, requireAdmin } from './auth.js';
import { log } from '../lib/logger.js';

const router = Router();

// GET /api/portfolio
// Get current user's portfolio (wallet + positions)
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;

    // Get user data
    const user = await userService.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get positions
    const positions = await tradingService.getUserPositions(userId);

    // Get recent transactions
    const transactions = await userService.getUserTransactions(userId, 20);

    res.json({
      success: true,
      portfolio: {
        user: {
          id: user.id,
          name: user.name,
          balance: user.balance,
          heldBalance: user.heldBalance,
          availableBalance: user.balance - user.heldBalance
        },
        positions: positions.map(formatPosition),
        transactions: transactions.map(formatTransaction)
      }
    });
  } catch (err) {
    log.error('[Portfolio] GET / error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio'
    });
  }
});

// GET /api/portfolio/:userId
// Admin: Get any user's portfolio
router.get('/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await userService.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const positions = await tradingService.getUserPositions(userId);
    const transactions = await userService.getUserTransactions(userId, 50);

    res.json({
      success: true,
      portfolio: {
        user: {
          id: user.id,
          name: user.name,
          balance: user.balance,
          heldBalance: user.heldBalance,
          availableBalance: user.balance - user.heldBalance
        },
        positions: positions.map(formatPosition),
        transactions: transactions.map(formatTransaction)
      }
    });
  } catch (err) {
    log.error(`[Portfolio] GET /${req.params.userId} error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio'
    });
  }
});

// PUT /api/portfolio/profile
// Update user profile (name)
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    // Update in DB
    const { supabase } = await import('../db/client.js');
    await supabase
      .from('users')
      .update({ name: name.trim() })
      .eq('id', userId);

    // Clear cache to refresh
    userService.clearUserCache(userId);

    const user = await userService.getUser(userId);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        balance: user.balance
      }
    });
  } catch (err) {
    log.error('[Portfolio] PUT /profile error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

// Helper functions
function formatPosition(pos) {
  return {
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
  };
}

function formatTransaction(tx) {
  return {
    id: tx.id,
    type: tx.type,
    amount: parseFloat(tx.amount),
    balanceAfter: parseFloat(tx.balance_after),
    description: tx.description,
    referenceId: tx.reference_id,
    createdAt: tx.created_at
  };
}

export default router;
