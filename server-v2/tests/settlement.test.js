/**
 * Settlement Service Tests
 *
 * Run with: npm test -- tests/settlement.test.js
 */

import { jest } from '@jest/globals';

// Mock database modules
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
  createTransaction: jest.fn(),
  createSettlement: jest.fn(),
  getSettlement: jest.fn(),
  getAllSettlements: jest.fn(),
  isMatchSettled: jest.fn(),
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

describe('Settlement Service', () => {
  let settlementService;
  let tradingService;
  let userService;
  let db;
  let state;

  beforeEach(async () => {
    jest.resetModules();

    db = await import('../db/index.js');
    state = await import('../lib/state.js');

    // Reset state
    state.clearAllCaches();

    // Default mocks
    db.getSettlement.mockResolvedValue(null);
    db.createSettlement.mockResolvedValue({
      id: 1,
      match_key: 'ind-vs-aus',
      winner: 'A',
      settled_by: 'admin'
    });
    db.closePosition.mockImplementation((posId, status) =>
      Promise.resolve({ id: posId, status })
    );
    db.createTransaction.mockResolvedValue({ id: 1 });
    db.updateBalance.mockImplementation((userId, balance, heldBalance) =>
      Promise.resolve({
        id: userId,
        balance: String(balance),
        held_balance: String(heldBalance)
      })
    );
    db.getUser.mockImplementation((userId) =>
      Promise.resolve({
        id: userId,
        name: 'User',
        balance: '100.00',
        held_balance: '10.00',
        created_at: new Date().toISOString()
      })
    );

    // Import services after mocks
    userService = await import('../services/userService.js');
    tradingService = await import('../services/tradingService.js');
    settlementService = await import('../services/settlementService.js');
  });

  describe('settleMatch', () => {
    test('should settle match and pay out winners', async () => {
      // Set up positions
      const positions = [
        {
          id: 1,
          user_id: 'winner1',
          match_key: 'ind-vs-aus',
          market_id: 1,
          direction: 'A',
          quantity: 10,
          avg_price: '0.60',
          status: 'open'
        },
        {
          id: 2,
          user_id: 'loser1',
          match_key: 'ind-vs-aus',
          market_id: 1,
          direction: 'B',
          quantity: 10,
          avg_price: '0.40',
          status: 'open'
        }
      ];

      db.getMatchPositions.mockResolvedValue(positions);

      // Set up users in state
      state.setUserState('winner1', {
        id: 'winner1',
        name: 'Winner',
        balance: 100,
        heldBalance: 6
      });
      state.setUserState('loser1', {
        id: 'loser1',
        name: 'Loser',
        balance: 100,
        heldBalance: 4
      });

      const result = await settlementService.settleMatch('ind-vs-aus', 'A', 'admin');

      expect(result.winner).toBe('A');
      expect(result.totalPositions).toBe(2);
      expect(result.winners.length).toBe(1);
      expect(result.losers.length).toBe(1);
      expect(result.winners[0].userId).toBe('winner1');
      expect(result.winners[0].payout).toBe(10);
      expect(result.losers[0].userId).toBe('loser1');
    });

    test('should reject settlement of already settled match', async () => {
      db.getSettlement.mockResolvedValue({
        id: 1,
        match_key: 'ind-vs-aus',
        winner: 'A'
      });

      await expect(
        settlementService.settleMatch('ind-vs-aus', 'B', 'admin')
      ).rejects.toThrow('already settled');
    });

    test('should reject invalid winner', async () => {
      await expect(
        settlementService.settleMatch('ind-vs-aus', 'C', 'admin')
      ).rejects.toThrow('Winner must be "A" or "B"');
    });

    test('should handle match with no positions', async () => {
      db.getMatchPositions.mockResolvedValue([]);

      const result = await settlementService.settleMatch('ind-vs-aus', 'A', 'admin');

      expect(result.totalPositions).toBe(0);
      expect(result.winners.length).toBe(0);
      expect(result.losers.length).toBe(0);
      expect(result.totalPayout).toBe(0);
    });
  });

  describe('isMatchSettled', () => {
    test('should return true for settled match', async () => {
      db.isMatchSettled.mockResolvedValue(true);

      const result = await settlementService.isMatchSettled('ind-vs-aus');

      expect(result).toBe(true);
    });

    test('should return false for unsettled match', async () => {
      db.isMatchSettled.mockResolvedValue(false);

      const result = await settlementService.isMatchSettled('ind-vs-aus');

      expect(result).toBe(false);
    });
  });
});
