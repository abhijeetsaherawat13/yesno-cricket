import supabase from './client.js';
import { log } from '../lib/logger.js';

export async function recordPrice(matchKey, marketId, priceA, priceB) {
  const { error } = await supabase
    .from('price_history')
    .insert({
      match_key: matchKey,
      market_id: marketId,
      price_a: priceA,
      price_b: priceB
    });

  if (error) {
    log.error('[DB:priceHistory] recordPrice error:', error);
  }
}

export async function getPriceHistory(matchKey, marketId = 1, hours = 4) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('match_key', matchKey)
    .eq('market_id', marketId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });

  if (error) {
    log.error('[DB:priceHistory] getPriceHistory error:', error);
    return [];
  }
  return data || [];
}

export async function getLatestPrice(matchKey, marketId = 1) {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('match_key', matchKey)
    .eq('market_id', marketId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    log.error('[DB:priceHistory] getLatestPrice error:', error);
  }
  return data;
}

export async function cleanOldPriceHistory(hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('price_history')
    .delete()
    .lt('recorded_at', cutoff);

  if (error) {
    log.error('[DB:priceHistory] cleanOldPriceHistory error:', error);
  }
}
