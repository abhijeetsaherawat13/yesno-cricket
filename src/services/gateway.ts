import type { GameMarket, LeaderboardEntry, Match } from '../types/app'
import { supabase } from '../lib/supabase'

const rawGatewayUrl = (import.meta.env.VITE_GATEWAY_URL as string | undefined)?.trim() ?? ''
const GATEWAY_BASE_URL = rawGatewayUrl.replace(/\/$/, '')
const GATEWAY_ADMIN_KEY = (import.meta.env.VITE_GATEWAY_ADMIN_KEY as string | undefined)?.trim() ?? ''
const gatewayEnabledFlag = ((import.meta.env.VITE_ENABLE_GATEWAY as string | undefined) ?? 'true').toLowerCase()

export const isGatewayEnabled = gatewayEnabledFlag !== 'false'

interface GatewayEnvelope {
  ok: boolean
  [key: string]: unknown
  error?: string
  code?: string
}

interface GatewayMatchResponse extends GatewayEnvelope {
  matches?: Match[]
}

interface GatewayMarketResponse extends GatewayEnvelope {
  markets?: GameMarket[]
  tradingStatus?: {
    suspended: boolean
    reason?: string
    updatedAt?: string
  }
}

interface GatewayHistoryPoint {
  at: string
  price: number
}

interface LeaderboardResponse extends GatewayEnvelope {
  leaderboard?: LeaderboardEntry[]
}

interface AdminOverview {
  fetchedAt: string | null
  stale: boolean
  feedSource: string
  matches: Array<{
    id: number
    label: string
    category: string
    isLive: boolean
    statusText: string
    priceA: number
    priceB: number
    tradingStatus: 'open' | 'suspended'
    reason?: string
    matchExposure: number
    settled: boolean
  }>
  users: Array<{
    userId: string
    balance: number
    suspended: boolean
    exposure: number
    openPositions: number
    lastSeenAt: string
  }>
  totals: {
    openPositions: number
    settledMatches: number
    audits: number
  }
  audits: Array<{
    id: string
    at: string
    type: string
    details: Record<string, unknown>
  }>
}

function toGatewayUrl(path: string): string {
  if (GATEWAY_BASE_URL) {
    return `${GATEWAY_BASE_URL}${path}`
  }

  return path
}

async function getAuthHeaders(): Promise<HeadersInit> {
  if (!supabase) return {}

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return { authorization: `Bearer ${session.access_token}` }
    }
  } catch {
    // Silently fail — request will go unauthenticated
  }

  return {}
}

async function fetchGateway<T extends GatewayEnvelope>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  if (!isGatewayEnabled) {
    return null
  }

  try {
    const authHeaders = await getAuthHeaders()

    const response = await fetch(toGatewayUrl(path), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    })

    const payload = (await response.json().catch(() => null)) as T | null

    if (!response.ok) {
      if (payload && typeof payload === 'object') {
        return payload
      }

      return {
        ok: false,
        error: `Request failed with status ${response.status}`,
      } as T
    }

    return payload
  } catch {
    return null
  }
}

/**
 * Retry wrapper — retries up to `retries` times with backoff on null results (network failures).
 * Non-null error responses (e.g. { ok: false, error: '...' }) are NOT retried.
 */
async function fetchWithRetry<T extends GatewayEnvelope>(
  path: string,
  init?: RequestInit,
  retries = 2,
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await fetchGateway<T>(path, init)
    if (result !== null) return result
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  return null
}

function adminHeaders(): HeadersInit {
  if (!GATEWAY_ADMIN_KEY) {
    return {}
  }

  return {
    'x-admin-key': GATEWAY_ADMIN_KEY,
  }
}

// ============================================================
// Public API functions
// ============================================================

export async function fetchGatewayMatches(): Promise<Match[] | null> {
  const payload = await fetchWithRetry<GatewayMatchResponse>('/api/live/matches')
  if (!payload?.ok) {
    return null
  }

  if (!Array.isArray(payload.matches) || payload.matches.length === 0) {
    return []
  }

  return payload.matches
}

export async function fetchGatewayMarkets(matchId: number): Promise<GatewayMarketResponse | null> {
  const payload = await fetchWithRetry<GatewayMarketResponse>(`/api/live/markets/${matchId}`)
  if (!payload?.ok) {
    return null
  }

  return payload
}

export async function fetchGatewayHistory(params: {
  matchId: number
  marketId: number
  optionLabel: string
  side: 'yes' | 'no'
  rangeMinutes?: number
}): Promise<GatewayHistoryPoint[] | null> {
  const query = new URLSearchParams()
  query.set('matchId', String(params.matchId))
  query.set('marketId', String(params.marketId))
  query.set('optionLabel', params.optionLabel)
  query.set('side', params.side)
  query.set('rangeMinutes', String(params.rangeMinutes ?? 120))

  const payload = await fetchWithRetry<GatewayEnvelope>(`/api/live/history?${query.toString()}`)
  if (!payload?.ok) {
    return null
  }

  const points = (payload as Record<string, unknown>).points
  if (!Array.isArray(points)) {
    return []
  }

  return points as GatewayHistoryPoint[]
}

interface GatewayPortfolioResponse extends GatewayEnvelope {
  user?: {
    userId: string
    balance: number
    name?: string | null
    email?: string | null
    kycStatus?: string | null
    kycPan?: string | null
    kycAadhaar?: string | null
    kycBankAccount?: string | null
    kycIfsc?: string | null
    kycHolderName?: string | null
    settings?: { notifications: boolean; sounds: boolean; biometric: boolean } | null
    suspended: boolean
    exposure: number
  }
  positions?: Array<Record<string, unknown>>
  transactions?: Array<{
    id: number
    type: string
    amount: number
    description: string
    icon: string
    timestamp: string
  }>
}

export async function fetchGatewayPortfolio(userId: string): Promise<GatewayPortfolioResponse | null> {
  return fetchGateway<GatewayPortfolioResponse>(`/api/trades/portfolio?userId=${encodeURIComponent(userId)}`)
}

export async function placeGatewayOrder(input: {
  userId: string
  matchId: number
  marketId: number
  marketTitle: string
  optionLabel: string
  side: 'yes' | 'no'
  amount: number
}) {
  const payload = await fetchGateway<GatewayEnvelope>('/api/trades/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return payload
}

export async function closeGatewayPosition(input: {
  userId: string
  positionId: number
  shares: number
}) {
  const payload = await fetchGateway<GatewayEnvelope>(
    `/api/trades/positions/${input.positionId}/close`,
    {
      method: 'POST',
      body: JSON.stringify({
        userId: input.userId,
        shares: input.shares,
      }),
    },
  )

  return payload
}

// ============================================================
// Withdrawal APIs
// ============================================================

export async function createWithdrawalRequest(input: {
  amount: number
  upiId?: string
  bankDetails?: string
}): Promise<GatewayEnvelope | null> {
  return fetchGateway<GatewayEnvelope>('/api/withdrawals', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function fetchAdminWithdrawals(): Promise<GatewayEnvelope | null> {
  if (!GATEWAY_ADMIN_KEY) return null

  return fetchGateway<GatewayEnvelope>('/api/admin/withdrawals', {
    headers: { ...adminHeaders() },
  })
}

export async function approveWithdrawal(requestId: number, adminNotes?: string): Promise<GatewayEnvelope | null> {
  if (!GATEWAY_ADMIN_KEY) return null

  return fetchGateway<GatewayEnvelope>(`/api/admin/withdrawals/${requestId}/approve`, {
    method: 'POST',
    headers: { ...adminHeaders() },
    body: JSON.stringify({ adminNotes }),
  })
}

export async function rejectWithdrawal(requestId: number, adminNotes?: string): Promise<GatewayEnvelope | null> {
  if (!GATEWAY_ADMIN_KEY) return null

  return fetchGateway<GatewayEnvelope>(`/api/admin/withdrawals/${requestId}/reject`, {
    method: 'POST',
    headers: { ...adminHeaders() },
    body: JSON.stringify({ adminNotes }),
  })
}

// ============================================================
// Admin APIs (existing)
// ============================================================

export async function fetchAdminOverview(): Promise<AdminOverview | null> {
  if (!GATEWAY_ADMIN_KEY) {
    return null
  }

  const payload = await fetchGateway<GatewayEnvelope>('/api/admin/overview', {
    headers: {
      ...adminHeaders(),
    },
  })

  if (!payload?.ok) {
    return null
  }

  const overview = (payload as Record<string, unknown>).overview
  if (!overview || typeof overview !== 'object') {
    return null
  }

  return overview as AdminOverview
}

export async function setGatewayMarketSuspended(matchId: number, suspended: boolean, reason = '') {
  if (!GATEWAY_ADMIN_KEY) {
    return null
  }

  return fetchGateway<GatewayEnvelope>(`/api/admin/market/${matchId}/pause`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
    },
    body: JSON.stringify({ suspended, reason }),
  })
}

export async function setGatewayUserSuspended(userId: string, suspended: boolean, reason = '') {
  if (!GATEWAY_ADMIN_KEY) {
    return null
  }

  return fetchGateway<GatewayEnvelope>(`/api/admin/user/${userId}/suspend`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
    },
    body: JSON.stringify({ suspended, reason }),
  })
}

export async function settleGatewayMatch(matchId: number, winnerTeam?: string) {
  if (!GATEWAY_ADMIN_KEY) {
    return null
  }

  return fetchGateway<GatewayEnvelope>(`/api/admin/settle/${matchId}`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
    },
    body: JSON.stringify({ winnerTeam }),
  })
}

// ============================================================
// Trade Tape
// ============================================================

export interface RecentTrade {
  side: 'yes' | 'no'
  optionLabel: string
  amount: number
  price: number
  at: string
}

export async function fetchRecentTrades(matchId: number): Promise<RecentTrade[]> {
  const payload = await fetchGateway<GatewayEnvelope>(`/api/live/trades/${matchId}`)
  if (!payload?.ok) return []

  const trades = (payload as Record<string, unknown>).trades
  if (!Array.isArray(trades)) return []

  return trades as RecentTrade[]
}

// ============================================================
// Leaderboard
// ============================================================

export async function fetchLeaderboard(): Promise<LeaderboardEntry[] | null> {
  const payload = await fetchWithRetry<LeaderboardResponse>('/api/leaderboard')
  if (!payload?.ok) {
    return null
  }
  return payload.leaderboard ?? []
}

// ============================================================
// Profile & KYC APIs
// ============================================================

export async function saveGatewayProfile(data: {
  userId: string
  name?: string
  email?: string
  settings?: { notifications: boolean; sounds: boolean; biometric: boolean }
}): Promise<GatewayEnvelope | null> {
  return fetchGateway<GatewayEnvelope>('/api/user/profile', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function saveGatewayKyc(data: {
  userId: string
  pan?: string
  aadhaar?: string
  bankAccount?: string
  ifsc?: string
  holderName?: string
  status?: string
}): Promise<GatewayEnvelope | null> {
  return fetchGateway<GatewayEnvelope>('/api/user/kyc', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
