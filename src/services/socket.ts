import { io, type Socket } from 'socket.io-client'
import { supabase } from '../lib/supabase'
import type { GameMarket, Match, Position } from '../types/app'

// ============================================================
// Connection status
// ============================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

type StatusListener = (status: ConnectionStatus) => void

let socket: Socket | null = null
let currentStatus: ConnectionStatus = 'disconnected'
const statusListeners = new Set<StatusListener>()

function notifyStatus(status: ConnectionStatus) {
  currentStatus = status
  for (const listener of statusListeners) {
    listener(status)
  }
}

export function getConnectionStatus(): ConnectionStatus {
  return currentStatus
}

export function onConnectionStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function isSocketAvailable(): boolean {
  return currentStatus === 'connected'
}

// ============================================================
// Connection management
// ============================================================

const rawGatewayUrl = (import.meta.env.VITE_GATEWAY_URL as string | undefined)?.trim() ?? ''
const GATEWAY_ADMIN_KEY = (import.meta.env.VITE_GATEWAY_ADMIN_KEY as string | undefined)?.trim() ?? ''

export async function connectSocket(): Promise<Socket> {
  if (socket?.connected) return socket

  // Disconnect any existing stale socket
  if (socket) {
    socket.disconnect()
    socket = null
  }

  // Get JWT token from Supabase session
  let token = ''
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      token = session?.access_token ?? ''
    } catch {
      // Proceed unauthenticated
    }
  }

  // Socket URL: use VITE_GATEWAY_URL if set, otherwise same-origin (undefined)
  const socketUrl = rawGatewayUrl || undefined

  socket = io(socketUrl, {
    auth: {
      token,
      adminKey: GATEWAY_ADMIN_KEY || undefined,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  })

  notifyStatus('connecting')

  socket.on('connect', () => {
    notifyStatus('connected')
  })

  socket.on('disconnect', () => {
    notifyStatus('disconnected')
  })

  socket.on('connect_error', async () => {
    notifyStatus('error')

    // Attempt token refresh on auth errors
    if (supabase) {
      try {
        const { data } = await supabase.auth.refreshSession()
        if (data.session?.access_token && socket) {
          socket.auth = {
            ...(socket.auth as Record<string, unknown>),
            token: data.session.access_token,
          }
        }
      } catch {
        // Token refresh failed, Socket.io reconnection will retry
      }
    }
  })

  return socket
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
    notifyStatus('disconnected')
  }
}

export function getSocket(): Socket | null {
  return socket
}

// ============================================================
// Room management
// ============================================================

export function subscribeToMatch(matchId: number): void {
  socket?.emit('match:subscribe', matchId)
}

export function unsubscribeFromMatch(matchId: number): void {
  socket?.emit('match:unsubscribe', matchId)
}

// ============================================================
// Event listener helpers (each returns an unsubscribe function)
// ============================================================

export interface MatchesUpdatePayload {
  matches: Match[]
}

export interface MarketsUpdatePayload {
  matchId: number
  markets: GameMarket[]
  tradingStatus: {
    suspended: boolean
    reason?: string
    updatedAt?: string
  }
}

export interface TradeConfirmedPayload {
  position: Position
  balance: number
}

export interface SettlementRow {
  userId: string
  positionId: number
  payout: number
  outcome: string
}

export interface PositionSettledPayload {
  matchId: number
  winnerCode: string
  winnerFull: string
  settledBy: string
  positions: SettlementRow[]
  balance: number
}

export interface PortfolioUpdatePayload {
  balance: number
  positions: Position[]
}

export interface AdminOverviewPayload {
  overview: Record<string, unknown>
}

export interface AdminWithdrawalRequestPayload {
  request: Record<string, unknown>
  userId: string
}

export function onMatchesUpdate(callback: (data: MatchesUpdatePayload) => void): () => void {
  socket?.on('matches:update', callback)
  return () => {
    socket?.off('matches:update', callback)
  }
}

export function onMarketsUpdate(callback: (data: MarketsUpdatePayload) => void): () => void {
  socket?.on('markets:update', callback)
  return () => {
    socket?.off('markets:update', callback)
  }
}

export function onTradeConfirmed(callback: (data: TradeConfirmedPayload) => void): () => void {
  socket?.on('trade:confirmed', callback)
  return () => {
    socket?.off('trade:confirmed', callback)
  }
}

export function onPositionSettled(callback: (data: PositionSettledPayload) => void): () => void {
  socket?.on('position:settled', callback)
  return () => {
    socket?.off('position:settled', callback)
  }
}

export function onPortfolioUpdate(callback: (data: PortfolioUpdatePayload) => void): () => void {
  socket?.on('portfolio:update', callback)
  return () => {
    socket?.off('portfolio:update', callback)
  }
}

export function onAdminOverview(callback: (data: AdminOverviewPayload) => void): () => void {
  socket?.on('admin:overview', callback)
  return () => {
    socket?.off('admin:overview', callback)
  }
}

export function onAdminWithdrawalRequest(
  callback: (data: AdminWithdrawalRequestPayload) => void,
): () => void {
  socket?.on('admin:withdrawal_request', callback)
  return () => {
    socket?.off('admin:withdrawal_request', callback)
  }
}
