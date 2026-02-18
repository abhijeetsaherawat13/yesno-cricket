import { Router } from 'express';
import { settlementService, userService, marketService } from '../services/index.js';
import { requireAdmin } from './auth.js';
import { log } from '../lib/logger.js';
import * as state from '../lib/state.js';

const router = Router();

// All admin routes require admin authentication
router.use(requireAdmin);

// POST /api/admin/settle
// Settle a match with a winner
router.post('/settle', async (req, res) => {
  try {
    const { matchKey, winner } = req.body;

    if (!matchKey) {
      return res.status(400).json({
        success: false,
        error: 'matchKey is required'
      });
    }

    if (!winner || !['A', 'B'].includes(winner)) {
      return res.status(400).json({
        success: false,
        error: 'winner must be "A" or "B"'
      });
    }

    const adminUserId = req.headers['x-admin-user'] || 'admin';

    const result = await settlementService.settleMatch(matchKey, winner, adminUserId);

    log.info(`[Admin] Match settled: ${matchKey}, winner=${winner}, by=${adminUserId}`);

    res.json({
      success: true,
      settlement: {
        matchKey: result.matchKey,
        winner: result.winner,
        totalPositions: result.totalPositions,
        winnersCount: result.winners.length,
        losersCount: result.losers.length,
        totalPayout: result.totalPayout
      }
    });
  } catch (err) {
    log.error('[Admin] POST /settle error:', err.message);

    if (err.message.includes('already settled')) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to settle match'
    });
  }
});

// GET /api/admin/settlements
// Get all settlements
router.get('/settlements', async (req, res) => {
  try {
    const settlements = await settlementService.getAllSettlements();

    res.json({
      success: true,
      settlements: settlements.map(s => ({
        id: s.id,
        matchKey: s.match_key,
        winner: s.winner,
        settledBy: s.settled_by,
        settledAt: s.settled_at
      }))
    });
  } catch (err) {
    log.error('[Admin] GET /settlements error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settlements'
    });
  }
});

// POST /api/admin/refresh-markets
// Force refresh markets from data sources
router.post('/refresh-markets', async (req, res) => {
  try {
    const count = await marketService.refreshMarkets();

    res.json({
      success: true,
      message: `Refreshed ${count} markets`
    });
  } catch (err) {
    log.error('[Admin] POST /refresh-markets error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh markets'
    });
  }
});

// POST /api/admin/user/:userId/refresh
// Clear user from cache, reload from DB
router.post('/user/:userId/refresh', async (req, res) => {
  try {
    const { userId } = req.params;

    userService.clearUserCache(userId);
    const user = await userService.getUser(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        balance: user.balance,
        heldBalance: user.heldBalance
      }
    });
  } catch (err) {
    log.error(`[Admin] POST /user/${req.params.userId}/refresh error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh user'
    });
  }
});

// DELETE /api/admin/user/:userId
// Delete user from cache (and optionally from DB)
router.delete('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const deleteFromDb = req.query.db === 'true';

    userService.clearUserCache(userId);

    if (deleteFromDb) {
      const { supabase } = await import('../db/client.js');
      await supabase.from('users').delete().eq('id', userId);
      log.warn(`[Admin] Deleted user ${userId} from DB`);
    }

    res.json({
      success: true,
      message: deleteFromDb
        ? `User ${userId} deleted from cache and DB`
        : `User ${userId} cleared from cache`
    });
  } catch (err) {
    log.error(`[Admin] DELETE /user/${req.params.userId} error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// GET /api/admin/stats
// Get system statistics
router.get('/stats', async (req, res) => {
  try {
    const cacheStats = state.getCacheStats();
    const markets = marketService.getAllMarkets();

    res.json({
      success: true,
      stats: {
        cache: cacheStats,
        markets: {
          total: markets.length,
          live: markets.filter(m => m.isLive).length,
          upcoming: markets.filter(m => !m.isLive).length
        },
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    });
  } catch (err) {
    log.error('[Admin] GET /stats error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats'
    });
  }
});

export default router;
