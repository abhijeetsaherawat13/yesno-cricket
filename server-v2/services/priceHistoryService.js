import * as db from '../db/index.js';
import { log } from '../lib/logger.js';
import { MARKET_TYPES, REFRESH_INTERVALS } from '../lib/constants.js';
import * as marketService from './marketService.js';

let cleanupInterval = null;

// Record current prices for all active markets
export async function recordAllPrices() {
  const markets = marketService.getAllMarkets();

  for (const market of markets) {
    if (!market.isLive) continue;

    try {
      await db.recordPrice(
        market.matchKey,
        MARKET_TYPES.MATCH_WINNER,
        market.priceA / 100, // Store as decimal
        market.priceB / 100
      );
    } catch (err) {
      log.error(`[PriceHistory] Error recording price for ${market.matchKey}:`, err.message);
    }
  }
}

// Get price history for a match
export async function getPriceHistory(matchKey, marketId = MARKET_TYPES.MATCH_WINNER, hours = 4) {
  const history = await db.getPriceHistory(matchKey, marketId, hours);

  return history.map(entry => ({
    timestamp: new Date(entry.recorded_at).getTime(),
    priceA: parseFloat(entry.price_a),
    priceB: parseFloat(entry.price_b)
  }));
}

// Clean up old price history
export async function cleanOldHistory(hours = 24) {
  await db.cleanOldPriceHistory(hours);
  log.info(`[PriceHistory] Cleaned history older than ${hours} hours`);
}

// Start periodic price recording
export function startRecording() {
  if (cleanupInterval) return;

  log.info(`[PriceHistory] Starting price recording (${REFRESH_INTERVALS.PRICE_HISTORY / 1000}s interval)`);

  // Record prices every minute
  setInterval(recordAllPrices, REFRESH_INTERVALS.PRICE_HISTORY);

  // Clean up old history every 6 hours
  cleanupInterval = setInterval(() => cleanOldHistory(24), REFRESH_INTERVALS.PRICE_CLEANUP);
}

// Stop recording
export function stopRecording() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('[PriceHistory] Stopped recording');
  }
}

export default {
  recordAllPrices,
  getPriceHistory,
  cleanOldHistory,
  startRecording,
  stopRecording
};
