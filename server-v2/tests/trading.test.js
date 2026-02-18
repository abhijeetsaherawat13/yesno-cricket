/**
 * Trading Service Tests
 *
 * Run with: npm test -- tests/trading.test.js
 */

import { jest } from '@jest/globals';

// Mock the database modules before importing services
jest.unstable_mockModule('../db/index.js', () => ({
  getUser: jest.fn(),
  createUser: jest.fn(),
  updateBalance: jest.fn(),
  createPosition: jest.fn(),
  getPosition: jest.fn(),
  getUserPositions: jest.fn(),
  getMatchPositions: jest.fn(),
  updatePosition: jest.fn(),
  closePosition: jest.fn(),
  updatePositionForTrade: jest.fn(),
  createTransaction: jest.fn(),
  supabase: {}
}));

// Mock market service
jest.unstable_mockModule('../services/marketService.js', () => ({
  getMarketPrices: jest.fn(),
  getAllMarkets: jest.fn(() => []),
  default: {
    getMarketPrices: jest.fn(),
    getAllMarkets: jest.fn(() => [])
  }
}));

describe('Trading Service', () => {
  let tradingService;
  let userService;
  let db;
  let marketService;
  let state;

  beforeEach(async () => {
    // Reset modules and mocks
    jest.resetModules();

    db = await import('../db/index.js');
    marketService = await import('../services/marketService.js');
    state = await import('../lib/state.js');

    // Reset state
    state.clearAllCaches();

    // Default mock implementations
    db.getUser.mockResolvedValue(null);
    db.createUser.mockImplementation((userId) =>
      Promise.resolve({
        id: userId,
        name: 'User',
        balance: '100.00',
        held_balance: '0.00',
        created_at: new Date().toISOString()
      })
    );
    db.updateBalance.mockImplementation((userId, balance, heldBalance) =>
      Promise.resolve({
        id: userId,
        balance: String(balance),
        held_balance: String(heldBalance)
      })
    );
    db.createPosition.mockImplementation((pos) =>
      Promise.resolve({
        id: 1,
        user_id: pos.userId,
        match_key: pos.matchKey,
        market_id: pos.marketId,
        direction: pos.direction,
        quantity: pos.quantity,
        avg_price: String(pos.avgPrice),
        status: 'open',
        created_at: new Date().toISOString()
      })
    );
    db.createTransaction.mockResolvedValue({ id: 1 });
    db.getUserPositions.mockResolvedValue([]);
    db.getMatchPositions.mockResolvedValue([]);

    marketService.getMarketPrices.mockReturnValue({
      priceA: 60,
      priceB: 40,
      labelA: 'IND',
      labelB: 'AUS'
    });

    // Import services after mocks are set up
    userService = await import('../services/userService.js');
    tradingService = await import('../services/tradingService.js');
  });

  describe('executeTrade', () => {
    test('should create new position for first trade', async () => {
      const result = await tradingService.executeTrade(
        'user123',
        'ind-vs-aus',
        1,
        'A',
        10
      );

      expect(result.positionId).toBe(1);
      expect(result.direction).toBe('A');
      expect(result.quantity).toBe(10);
      expect(result.cost).toBe(6); // 10 * (60/100)
      expect(db.createPosition).toHaveBeenCalled();
    });

    test('should reject trade with insufficient balance', async () => {
      // Set up user with low balance
      db.getUser.mockResolvedValue({
        id: 'user123',
        name: 'User',
        balance: '5.00',
        held_balance: '0.00',
        created_at: new Date().toISOString()
      });

      await expect(
        tradingService.executeTrade('user123', 'ind-vs-aus', 1, 'A', 100)
      ).rejects.toThrow('Insufficient balance');
    });

    test('should reject invalid direction', async () => {
      await expect(
        tradingService.executeTrade('user123', 'ind-vs-aus', 1, 'C', 10)
      ).rejects.toThrow('Direction must be "A" or "B"');
    });

    test('should reject invalid quantity', async () => {
      await expect(
        tradingService.executeTrade('user123', 'ind-vs-aus', 1, 'A', -5)
      ).rejects.toThrow('Quantity must be a positive integer');
    });

    test('should reject trade on non-existent market', async () => {
      marketService.getMarketPrices.mockReturnValue(null);

      await expect(
        tradingService.executeTrade('user123', 'unknown-match', 1, 'A', 10)
      ).rejects.toThrow('Market not found');
    });
  });

  describe('closePosition', () => {
    test('should close full position', async () => {
      // Set up existing position in state
      const position = {
        id: 1,
        dbId: 1,
        userId: 'user123',
        matchKey: 'ind-vs-aus',
        marketId: 1,
        direction: 'A',
        quantity: 10,
        avgPrice: 0.50,
        status: 'open'
      };
      state.addPosition(position);

      // Set up user in state
      state.setUserState('user123', {
        id: 'user123',
        name: 'User',
        balance: 100,
        heldBalance: 5
      });

      db.closePosition.mockResolvedValue({ ...position, status: 'closed' });

      const result = await tradingService.closePosition('user123', 1);

      expect(result.closedQuantity).toBe(10);
      expect(result.closePrice).toBe(60);
      expect(result.closeValue).toBe(6); // 10 * (60/100)
      expect(result.pnl).toBe(1); // 6 - (10 * 0.50)
    });

    test('should reject closing position of another user', async () => {
      const position = {
        id: 1,
        dbId: 1,
        userId: 'otheruser',
        matchKey: 'ind-vs-aus',
        marketId: 1,
        direction: 'A',
        quantity: 10,
        avgPrice: 0.50,
        status: 'open'
      };
      state.addPosition(position);

      await expect(
        tradingService.closePosition('user123', 1)
      ).rejects.toThrow('Position does not belong to user');
    });

    test('should reject closing already closed position', async () => {
      const position = {
        id: 1,
        dbId: 1,
        userId: 'user123',
        matchKey: 'ind-vs-aus',
        marketId: 1,
        direction: 'A',
        quantity: 10,
        avgPrice: 0.50,
        status: 'closed'
      };
      state.addPosition(position);

      await expect(
        tradingService.closePosition('user123', 1)
      ).rejects.toThrow('Position is not open');
    });
  });
});
