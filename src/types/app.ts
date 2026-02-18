export type KycStatus = 'pending' | 'submitted' | 'verified'
export type TxnType = 'credit' | 'debit'
export type AppRoute =
  | '/'
  | '/auth/phone'
  | '/auth/otp'
  | '/auth/success'
  | '/markets'
  | '/markets/search'
  | '/markets/notifications'
  | '/markets/game-view'
  | '/trade/buy'
  | '/trade/success'
  | '/trade/sell'
  | '/wallet'
  | '/wallet/deposit'
  | '/wallet/withdraw'
  | '/profile'
  | '/profile/edit'
  | '/profile/history'
  | '/profile/kyc'
  | '/profile/settings'
  | '/profile/help'
  | '/profile/terms'
  | '/admin'
  | '/leaderboard'

export interface User {
  phone: string
  name: string
  email?: string
}

export interface Match {
  id: number
  matchKey?: string  // Server-v2 uses matchKey for socket rooms and API calls
  teamA: string
  teamB: string
  teamAFull: string
  teamBFull: string
  flagA: string
  flagB: string
  scoreA: string
  scoreB: string
  oversA: string
  oversB: string
  priceA: number
  priceB: number
  volume: string
  time: string
  isLive: boolean
  category: string
  marketsCount: number
  statusText?: string
  matchName?: string
  matchType?: string
  oddsSource?: string
  sparkline?: number[]
}

export type MarketCategory =
  | 'winner'
  | 'sessions'
  | 'player'
  | 'wickets'
  | 'overbyover'
  | 'oddeven'

export type OptionColor = 'green' | 'blue' | 'red' | 'gray'

export interface MarketOption {
  label: string
  price: number
  type: OptionColor
}

export interface GameMarket {
  id: number
  category: MarketCategory
  title: string
  volume: string
  live?: boolean
  options: MarketOption[]
}

export interface Position {
  id: number
  matchId: number
  marketId?: number
  match: string
  market: string
  option: string
  side: 'yes' | 'no'
  shares: number
  avgPrice: number
  cost: number
  potentialPayout: number
  status: 'open' | 'closed' | 'settled'
  isLive: boolean
  timestamp: string
  outcome?: 'win' | 'lose' | 'void'
  payout?: number
  settledAt?: string
}

export interface Transaction {
  id: number
  timestamp: string
  type: TxnType
  amount: number
  description: string
  icon: string
}

export interface NotificationItem {
  id: number
  timestamp: string
  read: boolean
  title: string
  text: string
  icon: string
}

export interface AppModalAction {
  label: string
  primary?: boolean
  onClick?: () => void
}

export interface AppModalState {
  title: string
  text: string
  actions?: AppModalAction[]
}

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

export interface RouteData {
  phone?: string
  match?: Match
  market?: GameMarket
  option?: MarketOption
  side?: 'A' | 'B'
  position?: Position
}

export interface AppSettings {
  notifications: boolean
  sounds: boolean
  biometric: boolean
}

export interface WithdrawalRequest {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected' | 'sent'
  upiId?: string
  bankDetails?: string
  createdAt: string
}

export interface PortfolioStats {
  totalPnl: number
  winRate: number
  roi: number
  bestTradePnl: number
  bestTradeLabel: string
  totalSettled: number
  wins: number
  losses: number
  voids: number
  avgProfitPerTrade: number
}

export interface LeaderboardEntry {
  rank: number
  userId: string
  displayName: string
  totalPnl: number
  winRate: number
  tradesCount: number
  isCurrentUser: boolean
}
