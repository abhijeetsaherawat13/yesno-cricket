import { Router } from 'express';
import { marketService, priceHistoryService } from '../services/index.js';
import { log } from '../lib/logger.js';

const router = Router();

// GET /api/markets
// Get all active markets
router.get('/', async (req, res) => {
  try {
    const markets = marketService.getAllMarkets();

    res.json({
      success: true,
      markets: markets.map(formatMarket),
      count: markets.length
    });
  } catch (err) {
    log.error('[Markets] GET / error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch markets'
    });
  }
});

// GET /api/markets/:matchKey
// Get single market details
router.get('/:matchKey', async (req, res) => {
  try {
    const { matchKey } = req.params;
    const market = marketService.getMarket(matchKey);

    if (!market) {
      return res.status(404).json({
        success: false,
        error: 'Market not found'
      });
    }

    res.json({
      success: true,
      market: formatMarket(market)
    });
  } catch (err) {
    log.error(`[Markets] GET /${req.params.matchKey} error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch market'
    });
  }
});

// GET /api/price-history/:matchKey
// Get price history for charts
router.get('/price-history/:matchKey', async (req, res) => {
  try {
    const { matchKey } = req.params;
    const hours = parseInt(req.query.hours || '4', 10);

    const history = await priceHistoryService.getPriceHistory(matchKey, 1, hours);

    res.json({
      success: true,
      matchKey,
      history
    });
  } catch (err) {
    log.error(`[Markets] GET /price-history/${req.params.matchKey} error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch price history'
    });
  }
});

// Format market for client response (matches frontend expectations)
function formatMarket(market) {
  return {
    // Core identifiers
    matchKey: market.matchKey,

    // Teams
    teamA: market.teamA,
    teamB: market.teamB,
    teamAShort: market.teamAShort,
    teamBShort: market.teamBShort,
    flagA: '🏏', // Default cricket flag
    flagB: '🏏',

    // Match info
    matchType: market.matchType,
    category: market.category,
    statusText: market.statusText,
    timeLabel: market.timeLabel,
    isLive: market.isLive,

    // Prices (as percentages 1-99)
    priceA: market.priceA,
    priceB: market.priceB,
    labelA: market.labelA,
    labelB: market.labelB,

    // Markets array for multi-market support
    markets: market.markets?.map(m => ({
      marketId: m.marketId,
      name: m.name,
      labelA: m.labelA,
      labelB: m.labelB,
      priceA: m.priceA,
      priceB: m.priceB
    })) || [],

    // Metadata
    provider: market.provider,
    lastUpdated: market.lastUpdated
  };
}

export default router;
