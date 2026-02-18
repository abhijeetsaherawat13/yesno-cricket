import { log } from '../lib/logger.js';

// Base DataSource interface
export class DataSource {
  constructor(name) {
    this.name = name;
  }

  async fetchMatches() {
    throw new Error('Not implemented');
  }

  async fetchOdds(matchKey) {
    throw new Error('Not implemented');
  }
}

// Registry of data sources
const sources = new Map();

export function registerSource(name, source) {
  sources.set(name, source);
  log.info(`[DataSources] Registered: ${name}`);
}

export function getSource(name) {
  return sources.get(name);
}

export function getAllSources() {
  return Array.from(sources.values());
}

// Fetch matches from all registered sources
export async function fetchAllMatches() {
  const results = [];

  for (const [name, source] of sources) {
    try {
      const startTime = Date.now();
      const matches = await source.fetchMatches();
      const duration = Date.now() - startTime;

      log.datasource(name, 'fetchMatches', { count: matches.length, durationMs: duration });
      results.push(...matches);
    } catch (err) {
      log.error(`[DataSources] ${name} fetchMatches failed:`, err.message);
    }
  }

  return dedupeMatches(results);
}

// Deduplicate matches by normalized team names
function dedupeMatches(matches) {
  const seen = new Map();

  for (const match of matches) {
    const key = normalizeMatchKey(match.teamA, match.teamB);
    const reverseKey = normalizeMatchKey(match.teamB, match.teamA);

    if (!seen.has(key) && !seen.has(reverseKey)) {
      seen.set(key, match);
    }
  }

  return Array.from(seen.values());
}

function normalizeMatchKey(teamA, teamB) {
  const normalize = (name) => String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

  return `${normalize(teamA)}:${normalize(teamB)}`;
}

export default {
  DataSource,
  registerSource,
  getSource,
  getAllSources,
  fetchAllMatches
};
