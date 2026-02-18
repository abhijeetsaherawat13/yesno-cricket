import { createServer } from 'http';
import app from './app.js';
import { initSocket, broadcastMarketUpdate } from './socket.js';
import { log } from './lib/logger.js';
import { PORT } from './lib/constants.js';
import { marketService, priceHistoryService } from './services/index.js';
import { initDcric99Source } from './datasources/dcric99.js';
import { initMockSource } from './datasources/mock.js';

async function start() {
  log.info('=================================');
  log.info('YesNo Cricket Server v2.0.0');
  log.info('=================================');

  // Initialize data sources
  initDcric99Source();
  initMockSource();

  // Create HTTP server
  const httpServer = createServer(app);

  // Initialize Socket.io
  initSocket(httpServer);

  // Note: We handle market refresh manually below to add broadcast

  // Start price history recording
  priceHistoryService.startRecording();

  // Do initial market refresh and broadcast
  const refreshAndBroadcast = async () => {
    const count = await marketService.refreshMarkets();
    if (count > 0) {
      broadcastMarketUpdate(marketService.getAllMarkets());
    }
    return count;
  };

  // Initial refresh
  await refreshAndBroadcast();

  // Set up periodic refresh with broadcast
  setInterval(refreshAndBroadcast, 30000);

  // Start server
  httpServer.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info('=================================');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log.info('SIGTERM received, shutting down...');
    marketService.stopRefreshLoop();
    priceHistoryService.stopRecording();
    httpServer.close(() => {
      log.info('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    log.info('SIGINT received, shutting down...');
    marketService.stopRefreshLoop();
    priceHistoryService.stopRecording();
    httpServer.close(() => {
      log.info('Server closed');
      process.exit(0);
    });
  });
}

start().catch((err) => {
  log.error('Failed to start server:', err);
  process.exit(1);
});
