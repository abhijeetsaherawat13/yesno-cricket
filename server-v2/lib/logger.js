const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function formatTimestamp() {
  return new Date().toISOString();
}

function shouldLog(level) {
  return LOG_LEVELS[level] <= currentLevel;
}

export const log = {
  error: (...args) => {
    if (shouldLog('error')) {
      console.error(`[${formatTimestamp()}] ERROR:`, ...args);
    }
  },

  warn: (...args) => {
    if (shouldLog('warn')) {
      console.warn(`[${formatTimestamp()}] WARN:`, ...args);
    }
  },

  info: (...args) => {
    if (shouldLog('info')) {
      console.log(`[${formatTimestamp()}] INFO:`, ...args);
    }
  },

  debug: (...args) => {
    if (shouldLog('debug')) {
      console.log(`[${formatTimestamp()}] DEBUG:`, ...args);
    }
  },

  // Structured logging for data sources
  datasource: (name, action, data) => {
    if (shouldLog('info')) {
      console.log(`[${formatTimestamp()}] [${name}] ${action}:`,
        typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    }
  }
};

export default log;
