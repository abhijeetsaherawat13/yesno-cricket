// Server configuration
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

// Default values
export const DEFAULT_BALANCE = 100.00;
export const DEFAULT_USER_NAME = 'User';
export const WELCOME_BONUS = 100.00;

// Market configuration
export const MARKET_TYPES = {
  MATCH_WINNER: 1
};

// Position statuses
export const POSITION_STATUS = {
  OPEN: 'open',
  WON: 'won',
  LOST: 'lost',
  CLOSED: 'closed'
};

// Transaction types
export const TRANSACTION_TYPES = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  TRADE: 'trade',
  SETTLEMENT: 'settlement',
  BONUS: 'bonus'
};

// Data refresh intervals (in milliseconds)
export const REFRESH_INTERVALS = {
  MARKETS: 30 * 1000,           // 30 seconds
  PRICE_HISTORY: 60 * 1000,     // 1 minute
  PRICE_CLEANUP: 6 * 60 * 60 * 1000  // 6 hours
};

// Socket.io events
export const SOCKET_EVENTS = {
  MARKET_UPDATE: 'market-update',
  POSITION_UPDATE: 'position-update',
  BALANCE_UPDATE: 'balance-update',
  TRADE_EXECUTED: 'trade-executed',
  SETTLEMENT: 'settlement'
};

// Price modeling constants
export const PRICE_MODEL = {
  MIN_PRICE: 0.01,
  MAX_PRICE: 0.99,
  DEFAULT_PRICE_A: 0.5,
  VOLATILITY: 0.02
};
