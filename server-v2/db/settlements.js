import supabase from './client.js';
import { log } from '../lib/logger.js';

export async function createSettlement(matchKey, winner, settledBy) {
  const { data, error } = await supabase
    .from('settlements')
    .insert({
      match_key: matchKey,
      winner,
      settled_by: settledBy
    })
    .select()
    .single();

  if (error) {
    log.error('[DB:settlements] createSettlement error:', error);
    throw error;
  }
  return data;
}

export async function getSettlement(matchKey) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('match_key', matchKey)
    .single();

  if (error && error.code !== 'PGRST116') {
    log.error('[DB:settlements] getSettlement error:', error);
  }
  return data;
}

export async function getAllSettlements() {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .order('settled_at', { ascending: false });

  if (error) {
    log.error('[DB:settlements] getAllSettlements error:', error);
    return [];
  }
  return data || [];
}

export async function isMatchSettled(matchKey) {
  const settlement = await getSettlement(matchKey);
  return !!settlement;
}
