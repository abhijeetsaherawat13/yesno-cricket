import { fetchAllMatches } from '../datasources/index.js';
import * as state from '../lib/state.js';
import { log } from '../lib/logger.js';
import { MARKET_TYPES, REFRESH_INTERVALS } from '../lib/constants.js';

let refreshInterval = null;

// Build markets from data sources
export async function refreshMarkets() {
  try {
    const matches = await fetchAllMatches();
    log.info(`[MarketService] Fetched ${matches.length} matches`);

    for (const match of matches) {
      const existingMarket = state.getMarketState(match.matchKey);

      const market = {
        matchKey: match.matchKey,
        teamA: match.teamA,
        teamB: match.teamB,
        teamAShort: match.teamAShort,
        teamBShort: match.teamBShort,
        matchType: match.matchType,
        category: match.category,
        statusText: match.statusText,
        timeLabel: match.timeLabel,
        isLive: match.isLive,
        provider: match.provider,
        eventId: match.eventId,

        // Market 1: Match Winner
        markets: [{
          marketId: MARKET_TYPES.MATCH_WINNER,
          name: 'Match Winner',
          labelA: match.teamAShort || 'A',
          labelB: match.teamBShort || 'B',
          priceA: match.priceA,
          priceB: match.priceB
        }],

        // Preserve price history from existing market
        priceHistory: existingMarket?.priceHistory || [],

        lastUpdated: new Date().toISOString()
      };

      // Add current price to history
      market.priceHistory.push({
        timestamp: Date.now(),
        priceA: match.priceA,
        priceB: match.priceB
      });

      // Keep only last 4 hours of history
      const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
      market.priceHistory = market.priceHistory.filter(p => p.timestamp > fourHoursAgo);

      state.setMarketState(match.matchKey, market);
    }

    return matches.length;
  } catch (err) {
    log.error('[MarketService] Failed to refresh markets:', err.message);
    return 0;
  }
}

// Get all active markets
export function getAllMarkets() {
  return state.getAllMarkets().map(formatMarketForClient);
}

// Get single market
export function getMarket(matchKey) {
  const market = state.getMarketState(matchKey);
  return market ? formatMarketForClient(market) : null;
}

// Get current prices for a market
export function getMarketPrices(matchKey, marketId = MARKET_TYPES.MATCH_WINNER) {
  const market = state.getMarketState(matchKey);
  if (!market) return null;

  const marketData = market.markets.find(m => m.marketId === marketId);
  if (!marketData) return null;

  return {
    priceA: marketData.priceA,
    priceB: marketData.priceB,
    labelA: marketData.labelA,
    labelB: marketData.labelB
  };
}

// Get price history for a market
export function getPriceHistory(matchKey, marketId = MARKET_TYPES.MATCH_WINNER) {
  const market = state.getMarketState(matchKey);
  if (!market) return [];

  return market.priceHistory.map(p => ({
    timestamp: p.timestamp,
    priceA: p.priceA / 100, // Convert to 0-1 range for charts
    priceB: p.priceB / 100
  }));
}

// Format market for client response
function formatMarketForClient(market) {
  const matchWinner = market.markets.find(m => m.marketId === MARKET_TYPES.MATCH_WINNER) || {};

  return {
    matchKey: market.matchKey,
    eventId: market.eventId, // Include eventId for matchId resolution
    teamA: market.teamA,
    teamB: market.teamB,
    teamAShort: market.teamAShort,
    teamBShort: market.teamBShort,
    matchType: market.matchType,
    category: market.category,
    statusText: market.statusText,
    timeLabel: market.timeLabel,
    isLive: market.isLive,
    provider: market.provider,

    // Primary market (Match Winner)
    priceA: matchWinner.priceA || 50,
    priceB: matchWinner.priceB || 50,
    labelA: matchWinner.labelA || 'A',
    labelB: matchWinner.labelB || 'B',

    // All markets
    markets: market.markets,

    lastUpdated: market.lastUpdated
  };
}

// Start automatic market refresh
export function startRefreshLoop() {
  if (refreshInterval) return;

  log.info(`[MarketService] Starting refresh loop (${REFRESH_INTERVALS.MARKETS / 1000}s interval)`);

  // Initial refresh
  refreshMarkets();

  // Periodic refresh
  refreshInterval = setInterval(refreshMarkets, REFRESH_INTERVALS.MARKETS);
}

// Stop automatic market refresh
export function stopRefreshLoop() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    log.info('[MarketService] Stopped refresh loop');
  }
}

export default {
  refreshMarkets,
  getAllMarkets,
  getMarket,
  getMarketPrices,
  getPriceHistory,
  startRefreshLoop,
  stopRefreshLoop
};
