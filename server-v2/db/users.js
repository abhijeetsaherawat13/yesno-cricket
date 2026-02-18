import supabase from './client.js';
import { log } from '../lib/logger.js';

export async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    log.error('[DB:users] getUser error:', error);
  }
  return data;
}

export async function createUser(userId, name = 'User') {
  const { data, error } = await supabase
    .from('users')
    .insert({
      id: userId,
      name,
      balance: 100.00,
      held_balance: 0.00
    })
    .select()
    .single();

  if (error) {
    log.error('[DB:users] createUser error:', error);
    throw error;
  }
  return data;
}

export async function upsertUser(userId, name = 'User') {
  const { data, error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      name,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    log.error('[DB:users] upsertUser error:', error);
    throw error;
  }
  return data;
}

export async function updateBalance(userId, balance, heldBalance) {
  const updates = { updated_at: new Date().toISOString() };
  if (balance !== undefined) updates.balance = balance;
  if (heldBalance !== undefined) updates.held_balance = heldBalance;

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    log.error('[DB:users] updateBalance error:', error);
    throw error;
  }
  return data;
}

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    log.error('[DB:users] getAllUsers error:', error);
    return [];
  }
  return data || [];
}
