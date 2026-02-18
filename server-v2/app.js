import express from 'express';
import cors from 'cors';
import { log } from './lib/logger.js';
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

// Legacy route aliases for frontend compatibility
app.use('/gateway/portfolio', portfolioRouter);
app.use('/gateway/markets', marketsRouter);
app.use('/gateway/trade', tradingRouter);

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
