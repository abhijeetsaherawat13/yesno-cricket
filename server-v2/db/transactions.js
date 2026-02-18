import supabase from './client.js';
import { log } from '../lib/logger.js';

export async function createTransaction(tx) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: tx.userId,
      type: tx.type,
      amount: tx.amount,
      balance_after: tx.balanceAfter,
      reference_id: tx.referenceId || null,
      description: tx.description || null
    })
    .select()
    .single();

  if (error) {
    log.error('[DB:transactions] createTransaction error:', error);
    throw error;
  }
  return data;
}

export async function getUserTransactions(userId, limit = 50) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    log.error('[DB:transactions] getUserTransactions error:', error);
    return [];
  }
  return data || [];
}

export async function getTransactionsByType(userId, type, limit = 50) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    log.error('[DB:transactions] getTransactionsByType error:', error);
    return [];
  }
  return data || [];
}
