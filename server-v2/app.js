import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const FRONTEND_INDEX_FILE = path.join(FRONTEND_DIST_DIR, 'index.html');
const SERVE_FRONTEND = String(process.env.SERVE_FRONTEND ?? 'false').trim().toLowerCase() === 'true';
import {
  authRouter,
  portfolioRouter,
  marketsRouter,
  tradingRouter,
  adminRouter
} from './routes/index.js';

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving for frontend (when enabled)
if (SERVE_FRONTEND && fs.existsSync(FRONTEND_INDEX_FILE)) {
  log.info(`[Frontend] Serving from ${FRONTEND_DIST_DIR}`);
  // Hashed assets - cache 1 year
  app.use('/assets', express.static(path.join(FRONTEND_DIST_DIR, 'assets'), {
    index: false,
    maxAge: '365d',
    immutable: true,
  }));
  // Other static files - cache 5 minutes
  app.use(express.static(FRONTEND_DIST_DIR, {
    index: false,
    maxAge: '5m',
  }));
}

// Request logging (for non-health endpoints)
app.use((req, res, next) => {
  if (req.path !== '/health') {
    log.debug(`${req.method} ${req.path}`);
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/trade', tradingRouter);
app.use('/api/admin', adminRouter);

// Frontend-compatible route aliases
// Frontend calls /api/trades/portfolio instead of /api/portfolio
app.use('/api/trades/portfolio', portfolioRouter);
// Frontend calls /api/trades/orders for placing trades
app.use('/api/trades', tradingRouter);

// Frontend calls /api/live/matches for match list
app.use('/api/live', marketsRouter);

// Legacy route aliases for frontend compatibility
app.use('/gateway/portfolio', portfolioRouter);
app.use('/gateway/markets', marketsRouter);
app.use('/gateway/trade', tradingRouter);

// SPA catch-all - serve index.html for non-API routes
if (SERVE_FRONTEND) {
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) {
      return next();
    }
    if (!fs.existsSync(FRONTEND_INDEX_FILE)) {
      return res.status(503).json({
        success: false,
        error: 'Frontend build not found. Run npm run build first.'
      });
    }
    res.sendFile(FRONTEND_INDEX_FILE);
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  log.error(`[Express] Error: ${err.message}`);

  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

export default app;
