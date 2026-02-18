import supabase from './client.js';
import { log } from '../lib/logger.js';

export async function createPosition(position) {
  const { data, error } = await supabase
    .from('positions')
    .insert({
      user_id: position.userId,
      match_key: position.matchKey,
      market_id: position.marketId,
      direction: position.direction,
      quantity: position.quantity,
      avg_price: position.avgPrice,
      status: 'open'
    })
    .select()
    .single();

  if (error) {
    log.error('[DB:positions] createPosition error:', error);
    throw error;
  }
  return data;
}

export async function getPosition(positionId) {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .single();

  if (error && error.code !== 'PGRST116') {
    log.error('[DB:positions] getPosition error:', error);
  }
  return data;
}

export async function getUserPositions(userId, status = 'open') {
  const query = supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId);

  if (status) {
    query.eq('status', status);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    log.error('[DB:positions] getUserPositions error:', error);
    return [];
  }
  return data || [];
}

export async function getMatchPositions(matchKey, status = 'open') {
  const query = supabase
    .from('positions')
    .select('*')
    .eq('match_key', matchKey);

  if (status) {
    query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    log.error('[DB:positions] getMatchPositions error:', error);
    return [];
  }
  return data || [];
}

export async function updatePosition(positionId, updates) {
  const { data, error } = await supabase
    .from('positions')
    .update(updates)
    .eq('id', positionId)
    .select()
    .single();

  if (error) {
    log.error('[DB:positions] updatePosition error:', error);
    throw error;
  }
  return data;
}

export async function closePosition(positionId, status = 'closed') {
  return updatePosition(positionId, {
    status,
    closed_at: new Date().toISOString()
  });
}

export async function updatePositionForTrade(positionId, quantity, avgPrice) {
  return updatePosition(positionId, { quantity, avg_price: avgPrice });
}
