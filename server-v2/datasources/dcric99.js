import { DataSource, registerSource } from './index.js';
import { log } from '../lib/logger.js';

// Configuration
const DCRIC99_ENABLED = process.env.DCRIC99_ENABLED !== 'false';
const DCRIC99_EVENT_LIST_URL = process.env.DCRIC99_EVENT_LIST_URL || 'https://api.dcric99.com/api/guest/event_list';
const DCRIC99_EVENT_DETAIL_URL = process.env.DCRIC99_EVENT_DETAIL_URL || 'https://api.dcric99.com/api/guest/event';
const DCRIC99_DEFAULT_ODDS_BASE_URL = process.env.DCRIC99_ODDS_BASE_URL || 'https://api.dcric99.com';
const DCRIC99_MAX_EVENTS = parseInt(process.env.DCRIC99_MAX_EVENTS || '15', 10);
const DCRIC99_CONCURRENCY = parseInt(process.env.DCRIC99_CONCURRENCY || '5', 10);

// Utility functions
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPrice(value) {
  return clamp(Math.round(value), 1, 99);
}

// Generate mock odds when real odds unavailable
function generateMockOdds() {
  // Random price between 30-70 for team A
  const priceA = Math.floor(Math.random() * 40) + 30;
  const priceB = 100 - priceA;
  return { priceA, priceB };
}

function clampProbability(value) {
  return clamp(value, 0.01, 0.99);
}

function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortCode(name) {
  const words = normalizeTeamName(name).split(' ').filter(Boolean);
  if (words.length === 0) return 'TEAM';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

function parseTeamsFromName(name) {
  const head = String(name || '').split(',')[0]?.trim() || '';
  if (!head) return null;

  const parts = head.split(/\s+vs\s+|\s+v\s+/i);
  if (parts.length < 2) return null;

  return [parts[0].trim(), parts[1].trim()];
}

function generateMatchKey(teamA, teamB) {
  const normalize = (name) => normalizeTeamName(name).replace(/\s+/g, '-').slice(0, 20);
  const date = new Date().toISOString().split('T')[0];
  return `${normalize(teamA)}-vs-${normalize(teamB)}-${date}`;
}

// Price parsing
function parseDcricPriceProbability(rawPrice) {
  const numeric = asNumber(rawPrice, 0);
  if (numeric <= 0) return null;

  // Dcric bookmaker style: 107 means 1.07 net odds
  if (numeric >= 50 && numeric <= 1000) {
    return clampProbability(1 / (1 + numeric / 100));
  }

  if (numeric > 1 && numeric < 100) {
    return clampProbability(1 / numeric);
  }

  if (numeric <= 1) {
    return clampProbability(numeric);
  }

  return null;
}

function toPricePair(probabilityA, probabilityB) {
  const total = probabilityA + probabilityB;
  if (!Number.isFinite(total) || total <= 0) return null;

  const normalizedA = clampPrice((probabilityA / total) * 100);
  const normalizedB = clampPrice(100 - normalizedA);

  return { priceA: normalizedA, priceB: normalizedB };
}

// API fetching
async function fetchJson(url, timeoutMs = 20000, label = 'unknown') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'yesno-gateway/2.0' }
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      log.warn(`[${label}] HTTP ${response.status} (${duration}ms)`);
      return null;
    }

    const data = await response.json();
    log.debug(`[${label}] OK (${duration}ms)`);
    return data;
  } catch (err) {
    const duration = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError';
    log.error(`[${label}] ${isTimeout ? 'Timeout' : err.message} (${duration}ms)`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEventDetail(eventId) {
  const url = `${DCRIC99_EVENT_DETAIL_URL}/${encodeURIComponent(eventId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': 'yesno-gateway/2.0'
      },
      body: '{}'
    });

    if (!response.ok) return null;

    const payload = asRecord(await response.json());
    return asRecord(payload.data);
  } catch (err) {
    log.error(`[dcric99] Event detail error for ${eventId}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOddsRows(baseUrl, marketIds) {
  if (marketIds.length === 0) return [];

  const requestBody = marketIds
    .slice(0, 200)
    .map(id => `market_ids[]=${encodeURIComponent(id)}`)
    .join('&');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/ws/getMarketDataNew`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'application/json',
        'user-agent': 'yesno-gateway/2.0'
      },
      body: requestBody
    });

    if (!response.ok) return [];

    const text = await response.text();
    if (!text) return [];

    const parsed = asArray(JSON.parse(text));
    return parsed.map(row => asString(row)).filter(Boolean);
  } catch (err) {
    log.error('[dcric99] Odds fetch error:', err.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildSelectionNameMap(eventPayload) {
  const namesBySelectionId = new Map();

  for (const market of asArray(eventPayload.markets)) {
    for (const runner of asArray(market?.runners)) {
      const selectionId = asString(runner?.selection_id).trim();
      const name = asString(runner?.name).trim();
      if (selectionId && name) namesBySelectionId.set(selectionId, name);
    }
  }

  for (const book of asArray(eventPayload.book_makers)) {
    for (const runner of asArray(book?.book_maker_odds)) {
      const selectionId = asString(runner?.selection_id).trim();
      const name = asString(runner?.name).trim();
      if (selectionId && name && !namesBySelectionId.has(selectionId)) {
        namesBySelectionId.set(selectionId, name);
      }
    }
  }

  return namesBySelectionId;
}

function buildMarketIds(eventPayload) {
  const marketIds = [];

  for (const value of Object.values(eventPayload)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        const marketId = asString(asRecord(row).market_id).trim();
        if (marketId) marketIds.push(marketId);
      }
    } else if (typeof value === 'object' && value !== null) {
      const marketId = asString(asRecord(value).market_id).trim();
      if (marketId) marketIds.push(marketId);
    }
  }

  return [...new Set(marketIds)].slice(0, 200);
}

function parseOddsRows(rows, detailPayload) {
  const marketKeys = asRecord(detailPayload.market_odds_keys);
  const marketIdIndex = asNumber(marketKeys.market_id, -1);
  const skipKeys = Math.max(0, Math.floor(asNumber(marketKeys.skip_keys, 8)));
  const runnerKey = Math.max(1, Math.floor(asNumber(marketKeys.runner_key, 14)));

  if (marketIdIndex < 0) return [];

  const selectionNames = buildSelectionNameMap(asRecord(detailPayload.event));
  const markets = [];

  for (const row of rows) {
    const fields = String(row || '').split('|');
    if (fields.length <= skipKeys) continue;

    const marketId = asString(fields[marketIdIndex]).trim();
    if (!marketId) continue;

    const runners = [];
    for (let index = skipKeys; index < fields.length; index += runnerKey) {
      const selectionId = asString(fields[index]).trim();
      if (!selectionId) continue;

      const backTop = asNumber(fields[index + 2], 0);
      const layTop = asNumber(fields[index + 8], 0);
      const prices = [backTop, layTop].filter(p => p > 0);
      const odds = prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : 0;

      runners.push({
        selectionId,
        name: selectionNames.get(selectionId) || '',
        odds
      });
    }

    if (runners.length >= 2) {
      markets.push({ marketId, runners });
    }
  }

  return markets;
}

function pickMatchWinnerPair(detailPayload, parsedMarkets, fallbackEventName = '') {
  const eventPayload = asRecord(detailPayload.event);
  const eventMeta = asRecord(eventPayload.event);
  const eventName = asString(eventMeta.event_name) ||
                    asString(eventMeta.name) ||
                    asString(fallbackEventName);

  const parsedTeams = parseTeamsFromName(eventName);

  for (const market of parsedMarkets) {
    const activeRunners = market.runners.filter(r => r.odds > 0);
    if (activeRunners.length !== 2) continue;

    const [runnerA, runnerB] = activeRunners;
    const teamA = asString(runnerA.name).trim() || parsedTeams?.[0] || '';
    const teamB = asString(runnerB.name).trim() || parsedTeams?.[1] || '';

    if (!teamA || !teamB || normalizeTeamName(teamA) === normalizeTeamName(teamB)) continue;

    const probabilityA = parseDcricPriceProbability(runnerA.odds);
    const probabilityB = parseDcricPriceProbability(runnerB.odds);
    if (!probabilityA || !probabilityB) continue;

    const pair = toPricePair(probabilityA, probabilityB);
    if (!pair) continue;

    return { teamA, teamB, ...pair };
  }

  return null;
}

// Concurrency helper
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Main data source class
class Dcric99DataSource extends DataSource {
  constructor() {
    super('dcric99');
  }

  async fetchMatches() {
    if (!DCRIC99_ENABLED) {
      log.warn('[dcric99] Disabled via DCRIC99_ENABLED=false');
      return [];
    }

    // Fetch event list
    const eventListPayload = asRecord(await fetchJson(DCRIC99_EVENT_LIST_URL, 15000, 'dcric99_events'));
    const eventRows = asArray(asRecord(eventListPayload.data).events)
      .map(asRecord)
      .filter(row => asNumber(row.event_type_id, 0) === 4) // Cricket only
      .slice(0, DCRIC99_MAX_EVENTS);

    if (eventRows.length === 0) {
      log.warn('[dcric99] No cricket events found');
      return [];
    }

    log.info(`[dcric99] Processing ${eventRows.length} cricket events`);

    // Fetch details for each event with concurrency limit
    const matchPromises = await mapWithConcurrency(
      eventRows,
      DCRIC99_CONCURRENCY,
      async (entry) => {
        const eventId = String(entry.event_id || entry.id || '').trim();
        if (!eventId) return null;

        const eventName = asString(entry.event_name || entry.name);

        // Parse team names from event name (e.g., "Lions v Warriors")
        const teams = parseTeamsFromName(eventName);
        if (!teams) return null; // Skip tournaments without "vs" in name

        const [teamA, teamB] = teams;

        // Try to get real odds, fall back to mock odds
        let priceA, priceB;
        let gotRealOdds = false;

        try {
          const detailPayload = await fetchEventDetail(eventId);
          const eventPayload = asRecord(detailPayload?.event);

          if (Object.keys(eventPayload).length > 0) {
            const marketIds = buildMarketIds(eventPayload);

            if (marketIds.length > 0) {
              const oddsHub = asString(detailPayload.odds_hub).replace(/^https?:\/\//, '').trim();
              const oddsBaseUrl = detailPayload.connect_odds_hub && oddsHub
                ? `https://${oddsHub}`
                : DCRIC99_DEFAULT_ODDS_BASE_URL;

              const rows = await fetchOddsRows(oddsBaseUrl, marketIds);

              if (rows.length > 0) {
                const parsedMarkets = parseOddsRows(rows, detailPayload);
                const pair = pickMatchWinnerPair(detailPayload, parsedMarkets, eventName);
                if (pair) {
                  priceA = pair.priceA;
                  priceB = pair.priceB;
                  gotRealOdds = true;
                }
              }
            }
          }
        } catch (err) {
          log.warn(`[dcric99] Failed to get odds for ${eventId}: ${err.message}`);
        }

        // Use mock odds if real odds not available
        if (!gotRealOdds) {
          const mock = generateMockOdds();
          priceA = mock.priceA;
          priceB = mock.priceB;
          log.debug(`[dcric99] Using mock odds for ${eventName}: ${priceA}/${priceB}`);
        }

        return {
          matchKey: generateMatchKey(teamA, teamB),
          teamA,
          teamB,
          teamAShort: shortCode(teamA),
          teamBShort: shortCode(teamB),
          matchType: 'Cricket',
          category: 'Cricket',
          statusText: entry.in_play ? 'Live' : 'Upcoming',
          timeLabel: entry.in_play ? 'Now' : 'Upcoming',
          isLive: Boolean(entry.in_play),
          priceA,
          priceB,
          provider: gotRealOdds ? 'dcric99' : 'dcric99-mock',
          eventId
        };
      }
    );

    const matches = matchPromises.filter(Boolean);
    const realOddsCount = matches.filter(m => m.provider === 'dcric99').length;
    const mockOddsCount = matches.filter(m => m.provider === 'dcric99-mock').length;
    log.info(`[dcric99] Fetched ${matches.length} matches (${realOddsCount} real odds, ${mockOddsCount} mock odds)`);
    return matches;
  }

  async fetchOdds(matchKey) {
    // For individual match odds refresh, we'd need to store eventId mapping
    // For now, just return null and rely on full refresh
    return null;
  }
}

// Auto-register
export function initDcric99Source() {
  if (DCRIC99_ENABLED) {
    registerSource('dcric99', new Dcric99DataSource());
  }
}

export default Dcric99DataSource;
