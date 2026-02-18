// In-memory state management
// This provides fast access while DB serves as source of truth

// Users cache: Map<userId, UserState>
export const users = new Map();

// Markets cache: Map<matchKey, MarketState>
export const markets = new Map();

// Positions cache: Map<positionId, Position>
export const positions = new Map();

// User positions index: Map<userId, Set<positionId>>
export const userPositions = new Map();

// Match positions index: Map<matchKey, Set<positionId>>
export const matchPositions = new Map();

// Helper functions
export function getUserState(userId) {
  return users.get(userId);
}

export function setUserState(userId, state) {
  users.set(userId, state);
}

export function getMarketState(matchKey) {
  return markets.get(matchKey);
}

export function setMarketState(matchKey, state) {
  markets.set(matchKey, state);
}

export function getAllMarkets() {
  return Array.from(markets.values());
}

export function addPosition(position) {
  positions.set(position.id, position);

  // Index by user
  if (!userPositions.has(position.userId)) {
    userPositions.set(position.userId, new Set());
  }
  userPositions.get(position.userId).add(position.id);

  // Index by match
  if (!matchPositions.has(position.matchKey)) {
    matchPositions.set(position.matchKey, new Set());
  }
  matchPositions.get(position.matchKey).add(position.id);
}

export function getPosition(positionId) {
  return positions.get(positionId);
}

export function removePosition(positionId) {
  const position = positions.get(positionId);
  if (!position) return;

  positions.delete(positionId);

  // Remove from user index
  const userPosSet = userPositions.get(position.userId);
  if (userPosSet) {
    userPosSet.delete(positionId);
  }

  // Remove from match index
  const matchPosSet = matchPositions.get(position.matchKey);
  if (matchPosSet) {
    matchPosSet.delete(positionId);
  }
}

export function getUserPositionIds(userId) {
  return userPositions.get(userId) || new Set();
}

export function getMatchPositionIds(matchKey) {
  return matchPositions.get(matchKey) || new Set();
}

export function clearUserCache(userId) {
  users.delete(userId);
}

export function clearAllCaches() {
  users.clear();
  markets.clear();
  positions.clear();
  userPositions.clear();
  matchPositions.clear();
}

// Stats for monitoring
export function getCacheStats() {
  return {
    users: users.size,
    markets: markets.size,
    positions: positions.size,
    userPositions: userPositions.size,
    matchPositions: matchPositions.size
  };
}
