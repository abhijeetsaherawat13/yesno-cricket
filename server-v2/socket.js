import { Server } from 'socket.io';
import { log } from './lib/logger.js';
import { SOCKET_EVENTS } from './lib/constants.js';
import { marketService } from './services/index.js';

let io = null;

// Initialize Socket.io
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.on('connection', (socket) => {
    log.debug(`[Socket] Client connected: ${socket.id}`);

    // Send current markets on connection
    socket.emit(SOCKET_EVENTS.MARKET_UPDATE, {
      markets: marketService.getAllMarkets()
    });

    // Handle subscription to specific matches
    socket.on('subscribe', (matchKey) => {
      socket.join(`match:${matchKey}`);
      log.debug(`[Socket] ${socket.id} subscribed to ${matchKey}`);
    });

    socket.on('unsubscribe', (matchKey) => {
      socket.leave(`match:${matchKey}`);
      log.debug(`[Socket] ${socket.id} unsubscribed from ${matchKey}`);
    });

    // Handle user-specific room
    socket.on('auth', (userId) => {
      socket.join(`user:${userId}`);
      log.debug(`[Socket] ${socket.id} authenticated as ${userId}`);
    });

    socket.on('disconnect', (reason) => {
      log.debug(`[Socket] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  log.info('[Socket] Initialized');
  return io;
}

// Get Socket.io instance
export function getIO() {
  return io;
}

// Broadcast market updates to all clients
export function broadcastMarketUpdate(markets) {
  if (!io) return;

  io.emit(SOCKET_EVENTS.MARKET_UPDATE, { markets });
}

// Broadcast update for a specific market
export function broadcastMatchUpdate(matchKey, market) {
  if (!io) return;

  io.to(`match:${matchKey}`).emit(SOCKET_EVENTS.MARKET_UPDATE, { market });
}

// Send position update to a specific user
export function sendPositionUpdate(userId, position) {
  if (!io) return;

  io.to(`user:${userId}`).emit(SOCKET_EVENTS.POSITION_UPDATE, { position });
}

// Send balance update to a specific user
export function sendBalanceUpdate(userId, balance) {
  if (!io) return;

  io.to(`user:${userId}`).emit(SOCKET_EVENTS.BALANCE_UPDATE, { balance });
}

// Broadcast trade execution
export function broadcastTradeExecuted(matchKey, trade) {
  if (!io) return;

  io.to(`match:${matchKey}`).emit(SOCKET_EVENTS.TRADE_EXECUTED, { trade });
}

// Broadcast settlement
export function broadcastSettlement(matchKey, settlement) {
  if (!io) return;

  io.emit(SOCKET_EVENTS.SETTLEMENT, { matchKey, settlement });
}

export default {
  initSocket,
  getIO,
  broadcastMarketUpdate,
  broadcastMatchUpdate,
  sendPositionUpdate,
  sendBalanceUpdate,
  broadcastTradeExecuted,
  broadcastSettlement
};
