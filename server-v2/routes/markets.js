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
      markets: markets.map((m, i) => formatMarket(m, i)),
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

// GET /api/live/matches (frontend compatible)
// Returns matches in the format expected by the frontend
router.get('/matches', async (req, res) => {
  try {
    const markets = marketService.getAllMarkets();

    res.json({
      ok: true,
      matches: markets.map((m, i) => formatMarket(m, i))
    });
  } catch (err) {
    log.error('[Markets] GET /live/matches error:', err.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch matches'
    });
  }
});

// GET /api/live/markets/:matchId (frontend compatible)
// Returns markets for a specific match by ID
router.get('/markets/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const allMarkets = marketService.getAllMarkets();

    // Find market by eventId or index
    let market = null;
    let marketIndex = 0;

    // Try to match by eventId first
    for (let i = 0; i < allMarkets.length; i++) {
      const m = allMarkets[i];
      if (String(m.eventId) === String(matchId) || m.matchKey === matchId) {
        market = m;
        marketIndex = i;
        break;
      }
    }

    // Try index-based lookup (matchId as 1-based index)
    if (!market) {
      const idx = parseInt(matchId, 10);
      if (idx > 0 && idx <= allMarkets.length) {
        market = allMarkets[idx - 1];
        marketIndex = idx - 1;
      }
    }

    if (!market) {
      return res.status(404).json({
        ok: false,
        error: 'Market not found'
      });
    }

    const formatted = formatMarket(market, marketIndex);

    res.json({
      ok: true,
      markets: formatted.markets?.map((m, i) => ({
        marketId: m.marketId,
        title: m.name || 'Match Winner',
        options: [
          { label: m.labelA || formatted.teamAShort, price: m.priceA },
          { label: m.labelB || formatted.teamBShort, price: m.priceB }
        ]
      })) || [{
        marketId: 1,
        title: 'Match Winner',
        options: [
          { label: formatted.teamAShort, price: formatted.priceA },
          { label: formatted.teamBShort, price: formatted.priceB }
        ]
      }],
      tradingStatus: {
        suspended: false,
        reason: null,
        updatedAt: market.lastUpdated
      }
    });
  } catch (err) {
    log.error(`[Markets] GET /markets/${req.params.matchId} error:`, err.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch markets'
    });
  }
});

// GET /api/markets/:matchKey
// Get single market details
router.get('/:matchKey', async (req, res) => {
  try {
    const { matchKey } = req.params;
    const allMarkets = marketService.getAllMarkets();
    const marketIndex = allMarkets.findIndex(m => m.matchKey === matchKey);
    const market = marketIndex >= 0 ? allMarkets[marketIndex] : null;

    if (!market) {
      return res.status(404).json({
        success: false,
        error: 'Market not found'
      });
    }

    res.json({
      success: true,
      market: formatMarket(market, marketIndex)
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
function formatMarket(market, index) {
  // Generate a numeric ID from eventId or use index
  const numericId = market.eventId
    ? parseInt(String(market.eventId).replace(/\D/g, '').slice(0, 9), 10) || (index + 1)
    : (index + 1);

  return {
    // Core identifiers - id is required by frontend
    id: numericId,
    matchKey: market.matchKey,
    eventId: market.eventId,

    // Teams
    teamA: market.teamAShort || market.teamA,
    teamB: market.teamBShort || market.teamB,
    teamAFull: market.teamA,
    teamBFull: market.teamB,
    teamAShort: market.teamAShort,
    teamBShort: market.teamBShort,
    flagA: '🏏', // Default cricket flag
    flagB: '🏏',

    // Match info
    matchType: market.matchType,
    category: market.category,
    statusText: market.statusText,
    timeLabel: market.timeLabel,
    time: market.timeLabel,
    isLive: market.isLive,

    // Scores (defaults)
    scoreA: '',
    scoreB: '',
    oversA: '',
    oversB: '',
    volume: '0',

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
