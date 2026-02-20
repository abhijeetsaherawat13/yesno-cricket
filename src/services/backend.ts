import { buildMarkets, matchesData } from '../data/mockData'
import { isSupabaseConfigured, requireSupabase, supabase } from '../lib/supabase'
import {
  closeGatewayPosition,
  fetchGatewayMarkets,
  fetchGatewayMatches,
  fetchGatewayPortfolio,
  isGatewayEnabled,
  placeGatewayOrder,
} from './gateway'
import {
  areLiveFeedsEnabled,
  getLiveMarketsForMatch,
  getLiveMatchesWithOdds,
} from './liveFeeds'
import {
  isSocketAvailable,
  onMarketsUpdate,
  subscribeToMatch,
  unsubscribeFromMatch,
} from './socket'
import type {
  GameMarket,
  KycStatus,
  Match,
  NotificationItem,
  Position,
  Transaction,
  User,
} from '../types/app'

interface Snapshot {
  user: User
  balance: number
  kycStatus: KycStatus
  positions: Position[]
  transactions: Transaction[]
  notifications: NotificationItem[]
}

interface BuySyncInput {
  position: Position
  amount: number
  userId?: string
}

interface SellSyncInput {
  positionId: number
  sellShares: number
  userId?: string
}

interface CashSyncInput {
  amount: number
}

const DEFAULT_USER_NAME = 'YesNo User'
const DEFAULT_SIGNUP_BONUS = 100

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const tenDigits = digits.slice(-10)
  return `+91${tenDigits}`
}

function fromE164(phone: string): string {
  if (!phone.startsWith('+91')) {
    return phone
  }

  return phone.slice(3)
}

function toPosition(row: Record<string, unknown>): Position {
  return {
    id: Number(row.id),
    matchId: Number(row.match_id),
    marketId: Number(row.market_id ?? 1),
    match: String(row.match_label ?? ''),
    market: String(row.market_title ?? ''),
    option: String(row.option_label ?? ''),
    side: (row.side as 'yes' | 'no') ?? 'yes',
    shares: Number(row.shares ?? 0),
    avgPrice: Number(row.avg_price ?? 0),
    cost: Number(row.cost ?? 0),
    potentialPayout: Number(row.potential_payout ?? 0),
    status: (row.status as 'open' | 'closed' | 'settled') ?? 'open',
    isLive: Boolean(row.is_live),
    timestamp: String(row.created_at ?? new Date().toISOString()),
    outcome: (row.outcome as 'win' | 'lose' | 'void' | undefined) ?? undefined,
    payout: row.payout != null ? Number(row.payout) : undefined,
    settledAt: row.settled_at ? String(row.settled_at) : undefined,
  }
}

function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: Number(row.id),
    timestamp: String(row.created_at ?? new Date().toISOString()),
    type: (row.type as 'credit' | 'debit') ?? 'debit',
    amount: Number(row.amount ?? 0),
    description: String(row.description ?? ''),
    icon: String(row.icon ?? '📝'),
  }
}

function toNotification(row: Record<string, unknown>): NotificationItem {
  return {
    id: Number(row.id),
    timestamp: String(row.created_at ?? new Date().toISOString()),
    read: Boolean(row.read),
    title: String(row.title ?? ''),
    text: String(row.text ?? ''),
    icon: String(row.icon ?? '📢'),
  }
}

function toMatch(row: Record<string, unknown>): Match {
  return {
    id: Number(row.id),
    teamA: String(row.team_a_code ?? 'A'),
    teamB: String(row.team_b_code ?? 'B'),
    teamAFull: String(row.team_a_full ?? 'Team A'),
    teamBFull: String(row.team_b_full ?? 'Team B'),
    flagA: String(row.flag_a ?? '🏏'),
    flagB: String(row.flag_b ?? '🏏'),
    scoreA: String(row.score_a ?? '0-0'),
    scoreB: String(row.score_b ?? '0-0'),
    oversA: String(row.overs_a ?? ''),
    oversB: String(row.overs_b ?? ''),
    priceA: Number(row.price_a ?? 50),
    priceB: Number(row.price_b ?? 50),
    volume: String(row.volume ?? '0'),
    time: String(row.time_label ?? 'TBD'),
    isLive: Boolean(row.is_live),
    category: String(row.category ?? 'Cricket'),
    marketsCount: Number(row.markets_count ?? 0),
  }
}

function toMarket(row: Record<string, unknown>): GameMarket {
  const yesPrice = Number(row.yes_price ?? 50)
  const noPrice = Number(row.no_price ?? Math.max(1, 100 - yesPrice))

  return {
    id: Number(row.id),
    category: String(row.category ?? 'winner') as GameMarket['category'],
    title: String(row.title ?? 'Market'),
    volume: String(row.volume ?? '0'),
    live: Boolean(row.is_live),
    options: [
      {
        label: String(row.yes_label ?? 'YES'),
        price: yesPrice,
        type: 'green',
      },
      {
        label: String(row.no_label ?? 'NO'),
        price: noPrice,
        type: 'red',
      },
    ],
  }
}

async function getCurrentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const client = requireSupabase()
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    return null
  }

  return data.user.id
}

async function ensureProfileAndWallet(phone: string): Promise<Snapshot | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const client = requireSupabase()
  const userId = await getCurrentUserId()
  if (!userId) {
    return null
  }

  const normalizedPhone = normalizePhone(phone)

  const { data: existingProfile } = await client
    .from('profiles')
    .select('id, phone, full_name, email, kyc_status')
    .eq('id', userId)
    .maybeSingle()

  if (!existingProfile) {
    await client.from('profiles').insert({
      id: userId,
      phone: normalizedPhone,
      full_name: DEFAULT_USER_NAME,
      email: null,
      kyc_status: 'pending',
    })
  }

  const { data: existingWallet } = await client
    .from('wallet_accounts')
    .select('user_id, balance, bonus_balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (!existingWallet) {
    await client.from('wallet_accounts').insert({
      user_id: userId,
      balance: DEFAULT_SIGNUP_BONUS,
      bonus_balance: DEFAULT_SIGNUP_BONUS,
    })

    await client.from('wallet_transactions').insert({
      user_id: userId,
      type: 'credit',
      amount: DEFAULT_SIGNUP_BONUS,
      description: 'Signup Bonus',
      icon: '🎁',
    })

    await client.from('user_notifications').insert({
      user_id: userId,
      title: 'Welcome!',
      text: 'Rs 100 bonus added to your wallet',
      icon: '🎉',
      read: false,
    })
  }

  return fetchSnapshot()
}

export async function sendOtp(phone: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { ok: true }
  }

  try {
    const client = requireSupabase()
    const { error } = await client.auth.signInWithOtp({
      phone: normalizePhone(phone),
      options: {
        shouldCreateUser: true,
      },
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to send OTP.' }
  }
}

export async function verifyOtp(phone: string, otp: string): Promise<{ ok: boolean; snapshot?: Snapshot; error?: string }> {
  if (!isSupabaseConfigured) {
    return { ok: true }
  }

  try {
    const client = requireSupabase()

    const { error } = await client.auth.verifyOtp({
      phone: normalizePhone(phone),
      token: otp,
      type: 'sms',
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    const snapshot = await ensureProfileAndWallet(phone)
    if (!snapshot) {
      return { ok: false, error: 'Unable to bootstrap account after OTP verification.' }
    }

    return { ok: true, snapshot }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'OTP verification failed.' }
  }
}

export async function logoutRemote() {
  if (!isSupabaseConfigured) {
    return
  }

  const client = requireSupabase()
  await client.auth.signOut()
}

export async function fetchSnapshot(): Promise<Snapshot | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const client = requireSupabase()
  const userId = await getCurrentUserId()
  if (!userId) {
    return null
  }

  const [{ data: profile }, { data: wallet }, { data: positions }, { data: transactions }, { data: notifications }] =
    await Promise.all([
      client
        .from('profiles')
        .select('phone, full_name, email, kyc_status')
        .eq('id', userId)
        .maybeSingle(),
      client.from('wallet_accounts').select('balance').eq('user_id', userId).maybeSingle(),
      client
        .from('positions')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['open', 'settled'])
        .order('created_at', { ascending: false }),
      client
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200),
      client
        .from('user_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

  if (!profile || !wallet) {
    return null
  }

  return {
    user: {
      phone: fromE164(String(profile.phone ?? '')),
      name: String(profile.full_name ?? DEFAULT_USER_NAME),
      email: (profile.email as string | null) ?? undefined,
    },
    balance: Number(wallet.balance ?? 0),
    kycStatus: (profile.kyc_status as KycStatus) ?? 'pending',
    positions: (positions ?? []).map((row) => toPosition(row as Record<string, unknown>)),
    transactions: (transactions ?? []).map((row) => toTransaction(row as Record<string, unknown>)),
    notifications: (notifications ?? []).map((row) => toNotification(row as Record<string, unknown>)),
  }
}

export async function fetchMatches(): Promise<Match[]> {
  const gatewayMatches = await fetchGatewayMatches()
  if (gatewayMatches !== null) {
    return gatewayMatches
  }

  const liveMatches = await getLiveMatchesWithOdds()
  if (liveMatches && liveMatches.length > 0) {
    return liveMatches
  }

  if (areLiveFeedsEnabled) {
    return []
  }

  if (!isSupabaseConfigured) {
    return matchesData
  }

  try {
    const client = requireSupabase()
    const { data, error } = await client
      .from('matches')
      .select('*')
      .in('status', ['upcoming', 'live'])
      .order('is_live', { ascending: false })
      .order('start_time', { ascending: true })

    if (error || !data || data.length === 0) {
      return matchesData
    }

    return data.map((row) => toMatch(row as Record<string, unknown>))
  } catch {
    return matchesData
  }
}

export async function fetchMarketsForMatch(match: Match): Promise<GameMarket[]> {
  const gatewayPayload = await fetchGatewayMarkets(match.id)
  if (gatewayPayload?.markets && gatewayPayload.markets.length > 0) {
    return gatewayPayload.markets
  }

  const liveMarkets = await getLiveMarketsForMatch(match)
  if (liveMarkets && liveMarkets.length > 0) {
    return liveMarkets
  }

  if (!isSupabaseConfigured) {
    return buildMarkets(match)
  }

  try {
    const client = requireSupabase()
    const { data, error } = await client
      .from('markets')
      .select('*')
      .eq('match_id', match.id)
      .in('status', ['open', 'suspended'])
      .order('id', { ascending: true })

    if (error || !data || data.length === 0) {
      return buildMarkets(match)
    }

    return data.map((row) => toMarket(row as Record<string, unknown>))
  } catch {
    return buildMarkets(match)
  }
}

export function subscribeToMatchMarketPrices(
  matchId: number,
  onUpdate: (updatedMarkets: GameMarket[]) => void,
  matchKey?: string,
): (() => void) {
  // Prefer Socket.io real-time push when connected
  if (isSocketAvailable()) {
    subscribeToMatch(matchId, matchKey)

    const cleanup = onMarketsUpdate((data) => {
      // Server-v2 sends matchId as matchKey (string), check both matchKey and matchId
      const matchesById = data.matchId === matchId
      const matchesByKey = matchKey && data.matchId === matchKey
      if ((matchesById || matchesByKey) && data.markets?.length > 0) {
        onUpdate(data.markets)
      }
    })

    return () => {
      unsubscribeFromMatch(matchId, matchKey)
      cleanup()
    }
  }

  // Fallback: gateway HTTP polling (30s)
  if (isGatewayEnabled) {
    const intervalId = window.setInterval(() => {
      void (async () => {
        const gatewayPayload = await fetchGatewayMarkets(matchId)
        if (!gatewayPayload?.markets || gatewayPayload.markets.length === 0) {
          return
        }

        onUpdate(gatewayPayload.markets)
      })()
    }, 30_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }

  // Fallback: live feeds HTTP polling (30s)
  if (areLiveFeedsEnabled) {
    const intervalId = window.setInterval(() => {
      void (async () => {
        const liveMatches = await getLiveMatchesWithOdds()
        if (!liveMatches) {
          return
        }

        const latestMatch = liveMatches.find((match) => match.id === matchId)
        if (!latestMatch) {
          return
        }

        onUpdate(buildMarkets(latestMatch))
      })()
    }, 30_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }

  // Fallback: Supabase Realtime
  if (!isSupabaseConfigured || !supabase) {
    return () => undefined
  }

  const client = requireSupabase()

  const channel = client
    .channel(`market-prices-${matchId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'markets',
        filter: `match_id=eq.${matchId}`,
      },
      async () => {
        const { data } = await client.from('markets').select('*').eq('match_id', matchId).order('id', { ascending: true })
        if (data && data.length > 0) {
          onUpdate(data.map((row) => toMarket(row as Record<string, unknown>)))
        }
      },
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

export async function syncBuyTrade({ position, amount, userId }: BuySyncInput): Promise<{ serverPosition?: Position; balance?: number }> {
  if (isGatewayEnabled) {
    const payload = await placeGatewayOrder({
      userId: userId ?? position.match + position.option,
      matchId: Number(position.matchId),
      marketId: Number(position.marketId ?? 1),
      marketTitle: position.market,
      optionLabel: position.option,
      side: position.side,
      amount,
    })

    if (!payload?.ok) {
      throw new Error(String(payload?.error ?? 'Gateway order rejected.'))
    }

    // Extract server-generated position (has the correct ID)
    const order = (payload as Record<string, unknown>).order as Record<string, unknown> | undefined
    if (order?.position) {
      const sp = order.position as Record<string, unknown>
      return {
        serverPosition: {
          id: Number(sp.id),
          matchId: Number(sp.matchId),
          marketId: Number(sp.marketId ?? 1),
          match: String(sp.matchLabel ?? position.match),
          market: String(sp.marketTitle ?? position.market),
          option: String(sp.optionLabel ?? position.option),
          side: (sp.side as 'yes' | 'no') ?? position.side,
          shares: Number(sp.shares ?? position.shares),
          avgPrice: Number(sp.avgPrice ?? position.avgPrice),
          cost: Number(sp.stake ?? amount),
          potentialPayout: Number(sp.shares ?? position.shares),
          status: 'open',
          isLive: Boolean(sp.isLive),
          timestamp: String(sp.openedAt ?? new Date().toISOString()),
        },
        balance: order.balance != null ? Number(order.balance) : undefined,
      }
    }

    return {}
  }

  if (!isSupabaseConfigured) {
    return {}
  }

  const client = requireSupabase()

  await client.rpc('execute_buy_order', {
    p_match_id: Number(position.matchId),
    p_match_label: position.match,
    p_market_title: position.market,
    p_option_label: position.option,
    p_side: position.side,
    p_shares: position.shares,
    p_avg_price: position.avgPrice,
    p_cost: amount,
    p_potential_payout: position.potentialPayout,
    p_is_live: position.isLive,
  })

  return {}
}

export interface SellResult {
  closeValue: number
  pnl: number
  balance: number
  closedShares: number
}

export async function syncSellTrade({ positionId, sellShares, userId }: SellSyncInput): Promise<SellResult | null> {
  if (isGatewayEnabled) {
    const payload = await closeGatewayPosition({
      userId: userId ?? `position-${positionId}`,
      positionId,
      shares: sellShares,
    })

    if (!payload?.ok) {
      throw new Error(String(payload?.error ?? 'Gateway close rejected.'))
    }

    // Return the server's actual values
    const close = (payload as Record<string, unknown>).close as Record<string, unknown> | undefined
    if (close) {
      return {
        closeValue: Number(close.closeValue ?? 0),
        pnl: Number(close.pnl ?? 0),
        balance: Number(close.balance ?? 0),
        closedShares: Number(close.closedShares ?? sellShares),
      }
    }

    return null
  }

  if (!isSupabaseConfigured) {
    return null
  }

  const client = requireSupabase()

  await client.rpc('execute_sell_order', {
    p_position_id: positionId,
    p_sell_shares: sellShares,
  })

  return null
}

/** @deprecated V1 — deposits disabled. Kept for potential future use. */
export async function syncDeposit({ amount }: CashSyncInput) {
  if (!isSupabaseConfigured) {
    return
  }

  const client = requireSupabase()
  await client.rpc('execute_wallet_deposit', { p_amount: amount })
}

/** @deprecated V1 — withdrawals now go through gateway withdrawal request flow. Kept for potential future use. */
export async function syncWithdraw({ amount }: CashSyncInput) {
  if (!isSupabaseConfigured) {
    return
  }

  const client = requireSupabase()
  await client.rpc('execute_wallet_withdrawal', { p_amount: amount })
}

export async function syncProfile(name: string, email: string) {
  if (!isSupabaseConfigured) {
    return
  }

  const userId = await getCurrentUserId()
  if (!userId) {
    return
  }

  const client = requireSupabase()

  await client
    .from('profiles')
    .update({
      full_name: name,
      email: email || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
}

export async function syncKycComplete() {
  if (!isSupabaseConfigured) {
    return
  }

  const userId = await getCurrentUserId()
  if (!userId) {
    return
  }

  const client = requireSupabase()
  await client
    .from('profiles')
    .update({
      kyc_status: 'verified',
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
}

interface GatewayPortfolioSnapshot {
  balance: number
  name?: string | null
  email?: string | null
  kycStatus?: KycStatus | null
  kycPan?: string | null
  kycAadhaar?: string | null
  kycBankAccount?: string | null
  kycIfsc?: string | null
  kycHolderName?: string | null
  settings?: { notifications: boolean; sounds: boolean; biometric: boolean } | null
  positions: Position[]
  transactions: Transaction[]
}

/**
 * Fetch portfolio (balance + positions + transactions) from the gateway server.
 * This is used instead of fetchSnapshot() for gateway mode, because gateway
 * stores positions in-memory (not Supabase).
 */
export async function fetchGatewayPortfolioSnapshot(userId: string): Promise<GatewayPortfolioSnapshot | null> {
  if (!isGatewayEnabled) return null

  const payload = await fetchGatewayPortfolio(userId)
  // Handle both success formats: payload.ok OR payload.success
  if (!payload?.ok && !(payload as Record<string, unknown>)?.success) return null

  // Handle both response formats: server-v2 wraps in `portfolio`, legacy has flat structure
  const portfolioWrapper = (payload as Record<string, unknown>).portfolio as Record<string, unknown> | undefined
  const rawPositions = (portfolioWrapper?.positions ?? payload.positions ?? []) as Array<Record<string, unknown>>
  const rawTransactions = (portfolioWrapper?.transactions ?? payload.transactions ?? []) as Array<{
    id: number
    type: string
    amount: number
    description: string
    icon: string
    timestamp: string
  }>
  const rawUser = (portfolioWrapper?.user ?? payload.user) as Record<string, unknown> | undefined

  const positions: Position[] = rawPositions.map((sp) => ({
    id: Number(sp.id),
    matchId: Number(sp.matchId),
    marketId: Number(sp.marketId ?? 1),
    match: String(sp.matchLabel ?? ''),
    market: String(sp.marketTitle ?? ''),
    option: String(sp.optionLabel ?? ''),
    side: (sp.side as 'yes' | 'no') ?? 'yes',
    shares: Number(sp.sharesRemaining ?? sp.shares ?? 0),
    avgPrice: Number(sp.avgPrice ?? 0),
    cost: Number(sp.stakeRemaining ?? sp.stake ?? 0),
    potentialPayout: Number(sp.sharesRemaining ?? sp.shares ?? 0),
    status: (sp.status as 'open' | 'closed' | 'settled') ?? 'open',
    isLive: Boolean(sp.isLive),
    timestamp: String(sp.openedAt ?? new Date().toISOString()),
    outcome: (sp.outcome as 'win' | 'lose' | 'void' | undefined) ?? undefined,
    payout: sp.payout != null ? Number(sp.payout) : undefined,
    settledAt: sp.settledAt ? String(sp.settledAt) : sp.closedAt ? String(sp.closedAt) : undefined,
  }))

  const transactions: Transaction[] = rawTransactions.map((t) => ({
    id: t.id,
    type: t.type as 'credit' | 'debit',
    amount: t.amount,
    description: t.description,
    icon: t.icon ?? '📝',
    timestamp: t.timestamp ?? new Date().toISOString(),
  }))

  // Use rawUser which handles both wrapped and flat response formats
  return {
    balance: Number(rawUser?.balance ?? 0),
    name: rawUser?.name as string | null | undefined,
    email: rawUser?.email as string | null | undefined,
    kycStatus: (rawUser?.kycStatus as KycStatus) ?? null,
    kycPan: rawUser?.kycPan as string | null | undefined,
    kycAadhaar: rawUser?.kycAadhaar as string | null | undefined,
    kycBankAccount: rawUser?.kycBankAccount as string | null | undefined,
    kycIfsc: rawUser?.kycIfsc as string | null | undefined,
    kycHolderName: rawUser?.kycHolderName as string | null | undefined,
    settings: rawUser?.settings as { notifications: boolean; sounds: boolean; biometric: boolean } | null | undefined,
    positions,
    transactions,
  }
}

export async function hydrateFromSession(): Promise<Snapshot | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const userId = await getCurrentUserId()
  if (!userId) {
    return null
  }

  // PERMANENT FIX: Gateway is the source of truth for all user data
  if (isGatewayEnabled) {
    const gwData = await fetchGatewayPortfolioSnapshot(userId)
    if (gwData) {
      return {
        user: {
          phone: userId,
          name: gwData.name ?? 'User',
          email: gwData.email ?? undefined,
        },
        balance: gwData.balance,
        kycStatus: gwData.kycStatus ?? 'pending',
        positions: gwData.positions,
        transactions: gwData.transactions,
        notifications: [],
      }
    }
  }

  // Fallback only if gateway unavailable
  return fetchSnapshot()
}
