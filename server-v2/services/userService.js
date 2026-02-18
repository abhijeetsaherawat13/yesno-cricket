import * as db from '../db/index.js';
import * as state from '../lib/state.js';
import { log } from '../lib/logger.js';
import { DEFAULT_BALANCE, WELCOME_BONUS, TRANSACTION_TYPES } from '../lib/constants.js';

// Get or create a user
export async function ensureUser(userId) {
  // Check memory cache first
  let user = state.getUserState(userId);
  if (user) {
    return user;
  }

  // Check database
  user = await db.getUser(userId);

  if (!user) {
    // Create new user with welcome bonus
    user = await db.createUser(userId);
    log.info(`[UserService] Created new user: ${userId}`);

    // Record welcome bonus transaction
    await db.createTransaction({
      userId,
      type: TRANSACTION_TYPES.BONUS,
      amount: WELCOME_BONUS,
      balanceAfter: user.balance,
      description: 'Welcome bonus'
    });
  }

  // Cache in memory
  state.setUserState(userId, {
    id: user.id,
    name: user.name,
    balance: parseFloat(user.balance),
    heldBalance: parseFloat(user.held_balance),
    createdAt: user.created_at
  });

  return state.getUserState(userId);
}

// Get user (cached or from DB)
export async function getUser(userId) {
  const cached = state.getUserState(userId);
  if (cached) return cached;

  const user = await db.getUser(userId);
  if (!user) return null;

  const userState = {
    id: user.id,
    name: user.name,
    balance: parseFloat(user.balance),
    heldBalance: parseFloat(user.held_balance),
    createdAt: user.created_at
  };

  state.setUserState(userId, userState);
  return userState;
}

// Update user balance
export async function updateBalance(userId, newBalance, newHeldBalance) {
  const user = await ensureUser(userId);

  // Update in DB
  await db.updateBalance(userId, newBalance, newHeldBalance);

  // Update cache
  state.setUserState(userId, {
    ...user,
    balance: newBalance,
    heldBalance: newHeldBalance
  });

  log.debug(`[UserService] Updated balance for ${userId}: ${newBalance} (held: ${newHeldBalance})`);

  return state.getUserState(userId);
}

// Deduct from available balance, add to held
export async function holdBalance(userId, amount) {
  const user = await ensureUser(userId);
  const available = user.balance - user.heldBalance;

  if (amount > available) {
    throw new Error(`Insufficient balance. Available: ${available.toFixed(2)}, Required: ${amount.toFixed(2)}`);
  }

  const newHeldBalance = user.heldBalance + amount;
  return updateBalance(userId, user.balance, newHeldBalance);
}

// Release held balance (e.g., when position is closed)
export async function releaseHeldBalance(userId, amount) {
  const user = await ensureUser(userId);
  const newHeldBalance = Math.max(0, user.heldBalance - amount);
  return updateBalance(userId, user.balance, newHeldBalance);
}

// Add to balance (e.g., settlement payout)
export async function addToBalance(userId, amount, type = TRANSACTION_TYPES.SETTLEMENT, description = '') {
  const user = await ensureUser(userId);
  const newBalance = user.balance + amount;

  await updateBalance(userId, newBalance, user.heldBalance);

  // Record transaction
  await db.createTransaction({
    userId,
    type,
    amount,
    balanceAfter: newBalance,
    description
  });

  return state.getUserState(userId);
}

// Deduct from balance (for trades)
export async function deductFromBalance(userId, amount, type = TRANSACTION_TYPES.TRADE, referenceId = '', description = '') {
  const user = await ensureUser(userId);

  if (amount > user.balance) {
    throw new Error(`Insufficient balance. Available: ${user.balance.toFixed(2)}, Required: ${amount.toFixed(2)}`);
  }

  const newBalance = user.balance - amount;
  const newHeldBalance = Math.max(0, user.heldBalance - amount); // Also reduce held if applicable

  await updateBalance(userId, newBalance, newHeldBalance);

  // Record transaction
  await db.createTransaction({
    userId,
    type,
    amount: -amount,
    balanceAfter: newBalance,
    referenceId,
    description
  });

  return state.getUserState(userId);
}

// Get user transactions
export async function getUserTransactions(userId, limit = 50) {
  return db.getUserTransactions(userId, limit);
}

// Clear user from cache (for admin refresh)
export function clearUserCache(userId) {
  state.clearUserCache(userId);
  log.info(`[UserService] Cleared cache for user: ${userId}`);
}

export default {
  ensureUser,
  getUser,
  updateBalance,
  holdBalance,
  releaseHeldBalance,
  addToBalance,
  deductFromBalance,
  getUserTransactions,
  clearUserCache
};
