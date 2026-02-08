import { useEffect, useRef, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { useAppNavigation } from '../hooks/useAppNavigation'
import { toAreaPoints, toLinePoints } from '../lib/chartUtils'
import { computeEquityCurve, computePortfolioStats } from '../lib/portfolioStats'
import { fetchGatewayPortfolioSnapshot, fetchMatches } from '../services/backend'
import { createWithdrawalRequest } from '../services/gateway'
import { isSocketAvailable, onPortfolioUpdate } from '../services/socket'
import { useAppStore } from '../store/useAppStore'
import type { Match, Position } from '../types/app'

function posCardClass(position: Position): string {
  if (position.status !== 'settled') return 'pos-card'
  if (position.outcome === 'win') return 'pos-card settled-win'
  if (position.outcome === 'lose') return 'pos-card settled-lose'
  return 'pos-card settled-void'
}

function computePnl(position: Position, matchesMap: Map<number, Match>): { currentPrice: number; pnl: number } | null {
  if (position.status === 'settled') return null
  const match = matchesMap.get(position.matchId)
  if (!match) return null

  // Use match winner prices to estimate current value
  let currentPrice = 0
  if (position.option === match.teamA || position.option === match.teamAFull) {
    currentPrice = position.side === 'yes' ? match.priceA : match.priceB
  } else if (position.option === match.teamB || position.option === match.teamBFull) {
    currentPrice = position.side === 'yes' ? match.priceB : match.priceA
  } else {
    // Non-winner market: fall back to avgPrice (no live P&L available)
    return null
  }

  const currentValue = (currentPrice / 100) * position.shares
  const pnl = currentValue - position.cost
  return { currentPrice, pnl }
}

export function WalletPage() {
  const appNavigate = useAppNavigation()
  const balance = useAppStore((state) => state.balance)
  const positions = useAppStore((state) => state.positions)
  const transactions = useAppStore((state) => state.transactions)
  const updateState = useAppStore((state) => state.updateState)
  const user = useAppStore((state) => state.user)

  const [activeTab, setActiveTab] = useState<'positions' | 'transactions' | 'stats'>('positions')
  const [matchesMap, setMatchesMap] = useState<Map<number, Match>>(new Map())
  const totalInPositions = positions.reduce((sum, position) => sum + position.cost, 0)
  const syncTimerRef = useRef<number | null>(null)

  // Fetch current match prices for live P&L
  useEffect(() => {
    let isCancelled = false

    void fetchMatches().then((matches) => {
      if (!isCancelled) {
        const map = new Map<number, Match>()
        for (const m of matches) map.set(m.id, m)
        setMatchesMap(map)
      }
    })

    return () => { isCancelled = true }
  }, [positions.length])

  // Portfolio auto-sync (socket + 30s polling fallback)
  useEffect(() => {
    const userId = user?.phone ?? 'anon'
    let cleanupSocket: (() => void) | null = null

    if (isSocketAvailable()) {
      cleanupSocket = onPortfolioUpdate((data) => {
        updateState({
          balance: data.balance,
          positions: data.positions,
        })
      })
    }

    // Polling fallback: every 30s refresh from gateway
    syncTimerRef.current = window.setInterval(() => {
      void fetchGatewayPortfolioSnapshot(userId).then((snap) => {
        if (snap) {
          updateState({ balance: snap.balance, positions: snap.positions })
        }
      })
    }, 30_000)

    return () => {
      cleanupSocket?.()
      if (syncTimerRef.current !== null) window.clearInterval(syncTimerRef.current)
    }
  }, [user?.phone, updateState])

  const stats = computePortfolioStats(positions)
  const equityCurve = computeEquityCurve(positions)
  const equityLine = toLinePoints(equityCurve)
  const equityArea = toAreaPoints(equityCurve)

  return (
    <div className="screen">
      <div className="app-header">
        <div className="header-content">
          <div className="logo">
            <span>💰</span>
            <span>Wallet</span>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="wallet-card">
          <div className="wallet-label">Total Balance</div>
          <div className="wallet-amount">Rs {balance.toFixed(2)}</div>
          <div className="wallet-stats">
            <div className="wallet-stat">
              <div className="wallet-stat-label">Available</div>
              <div className="wallet-stat-value">Rs {balance.toFixed(0)}</div>
            </div>
            <div className="wallet-stat">
              <div className="wallet-stat-label">In Positions</div>
              <div className="wallet-stat-value">Rs {totalInPositions.toFixed(0)}</div>
            </div>
          </div>
          <div className="wallet-actions">
            <button className="wallet-action-btn" onClick={() => appNavigate('/wallet/withdraw')}>
              💸 Withdraw
            </button>
          </div>
        </div>

        <div className="alert-box" style={{ background: '#E8F5E9', borderColor: '#2E7D32' }}>
          🎁 <strong>Signup bonus:</strong> Rs 100 credited. Trade and earn above Rs 500 to withdraw profits!
        </div>

        <div className="tabs">
          <div
            className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            Positions ({positions.length})
          </div>
          <div
            className={`tab ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            Transactions
          </div>
          <div
            className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            Stats
          </div>
        </div>

        {activeTab === 'positions' ? (
          <>
            {positions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div className="empty-title">No open positions</div>
                <div className="empty-text">Start trading to see your positions here</div>
                <button className="btn-primary" style={{ marginTop: 20, maxWidth: 200 }} onClick={() => appNavigate('/markets')}>
                  EXPLORE MARKETS
                </button>
              </div>
            ) : (
              positions.map((position) => {
                const livePnl = computePnl(position, matchesMap)
                return (
                  <div
                    key={position.id}
                    className={posCardClass(position)}
                    onClick={() => {
                      if (position.status !== 'settled') {
                        appNavigate('/trade/sell', { position })
                      }
                    }}
                    style={{ cursor: position.status === 'settled' ? 'default' : 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                          {position.option} ({position.side.toUpperCase()})
                        </div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          {position.match} · {position.market}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {position.status === 'settled' && position.outcome ? (
                          <span
                            style={{
                              background:
                                position.outcome === 'win'
                                  ? '#E8F5E9'
                                  : position.outcome === 'lose'
                                    ? '#FFEBEE'
                                    : '#F5F5F5',
                              color:
                                position.outcome === 'win'
                                  ? '#2E7D32'
                                  : position.outcome === 'lose'
                                    ? '#D32F2F'
                                    : '#757575',
                              padding: '2px 8px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {position.outcome === 'win' ? 'WON' : position.outcome === 'lose' ? 'LOST' : 'VOID'}
                          </span>
                        ) : position.isLive ? (
                          <span className="live-badge">
                            <span className="live-dot" /> Live
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 8,
                        paddingTop: 10,
                        borderTop: '1px solid #f0f0f0',
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#888' }}>SHARES</div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{position.shares}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#888' }}>AVG</div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{position.avgPrice}p</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#888' }}>COST</div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Rs {position.cost.toFixed(0)}</div>
                      </div>
                      {position.status === 'settled' ? (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: '#888' }}>RESULT</div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color:
                                position.outcome === 'win'
                                  ? '#00C853'
                                  : position.outcome === 'lose'
                                    ? '#D32F2F'
                                    : '#9E9E9E',
                            }}
                          >
                            {position.outcome === 'win'
                              ? `+Rs ${((position.payout ?? 0) - position.cost).toFixed(0)}`
                              : position.outcome === 'lose'
                                ? `-Rs ${position.cost.toFixed(0)}`
                                : `Rs ${(position.payout ?? 0).toFixed(0)} refund`}
                          </div>
                        </div>
                      ) : livePnl ? (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: '#888' }}>P&L</div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: livePnl.pnl >= 0 ? '#00C853' : '#D32F2F',
                            }}
                          >
                            {livePnl.pnl >= 0 ? '+' : ''}Rs {livePnl.pnl.toFixed(0)}
                          </div>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: '#888' }}>IF WIN</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#00C853' }}>
                            +Rs {(position.potentialPayout - position.cost).toFixed(0)}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Quick Sell button for open positions */}
                    {position.status !== 'settled' ? (
                      <div style={{ marginTop: 10, textAlign: 'right' }}>
                        <button
                          className="quick-sell-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            appNavigate('/trade/sell', { position })
                          }}
                        >
                          SELL
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </>
        ) : activeTab === 'transactions' ? (
          <>
            {transactions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <div className="empty-title">No transactions yet</div>
                <div className="empty-text">Your transaction history will appear here</div>
              </div>
            ) : (
              <div className="market-card">
                {transactions.map((transaction, index) => (
                  <div
                    key={transaction.id}
                    style={{
                      padding: '10px 0',
                      borderBottom: index < transactions.length - 1 ? '1px solid #f0f0f0' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {transaction.icon} {transaction.description}
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: transaction.type === 'credit' ? '#00C853' : '#D32F2F',
                        }}
                      >
                        {transaction.type === 'credit' ? '+' : '-'}Rs {transaction.amount.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#888' }}>
                      {new Date(transaction.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {stats.totalSettled === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📈</div>
                <div className="empty-title">No settled trades yet</div>
                <div className="empty-text">Your portfolio stats will appear after your first settlement</div>
              </div>
            ) : (
              <>
                <div className="stats-kpi-grid">
                  <div className={`stats-kpi-card ${stats.totalPnl >= 0 ? 'kpi-positive' : 'kpi-negative'}`}>
                    <div className="stats-kpi-label">Total P&L</div>
                    <div className="stats-kpi-value">
                      {stats.totalPnl >= 0 ? '+' : ''}Rs {stats.totalPnl.toFixed(0)}
                    </div>
                  </div>
                  <div className="stats-kpi-card">
                    <div className="stats-kpi-label">Win Rate</div>
                    <div className="stats-kpi-value">{stats.winRate.toFixed(1)}%</div>
                  </div>
                  <div className="stats-kpi-card">
                    <div className="stats-kpi-label">ROI</div>
                    <div className="stats-kpi-value">
                      {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
                    </div>
                  </div>
                  <div className="stats-kpi-card kpi-positive">
                    <div className="stats-kpi-label">Best Trade</div>
                    <div className="stats-kpi-value">+Rs {stats.bestTradePnl.toFixed(0)}</div>
                    <div className="stats-kpi-sub">{stats.bestTradeLabel}</div>
                  </div>
                </div>

                <div className="section-label">Equity Curve</div>
                <div className="chart-container">
                  <svg viewBox="0 0 300 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                    <defs>
                      <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={stats.totalPnl >= 0 ? '#2E7D32' : '#D32F2F'} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={stats.totalPnl >= 0 ? '#2E7D32' : '#D32F2F'} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <polyline fill="url(#equityGrad)" stroke="none" points={equityArea} />
                    <polyline
                      fill="none"
                      stroke={stats.totalPnl >= 0 ? '#2E7D32' : '#D32F2F'}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={equityLine}
                    />
                  </svg>
                </div>

                <div className="section-label">Trade Summary</div>
                <div className="summary-box">
                  <div className="summary-row">
                    <span>Settled Trades</span>
                    <strong>{stats.totalSettled}</strong>
                  </div>
                  <div className="summary-row">
                    <span style={{ color: '#2E7D32' }}>Wins</span>
                    <strong style={{ color: '#2E7D32' }}>{stats.wins}</strong>
                  </div>
                  <div className="summary-row">
                    <span style={{ color: '#D32F2F' }}>Losses</span>
                    <strong style={{ color: '#D32F2F' }}>{stats.losses}</strong>
                  </div>
                  <div className="summary-row">
                    <span style={{ color: '#9E9E9E' }}>Voided</span>
                    <strong style={{ color: '#9E9E9E' }}>{stats.voids}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Avg Profit/Trade</span>
                    <strong>{stats.avgProfitPerTrade >= 0 ? '+' : ''}Rs {stats.avgProfitPerTrade.toFixed(0)}</strong>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <BottomNav active="wallet" />
    </div>
  )
}

/** DepositPage — disabled for V1 (no real deposits). Redirects to wallet. */
export function DepositPage() {
  const appNavigate = useAppNavigation()
  useEffect(() => {
    appNavigate('/wallet')
  }, [appNavigate])
  return null
}

export function WithdrawPage() {
  const appNavigate = useAppNavigation()
  const balance = useAppStore((state) => state.balance)
  const addNotification = useAppStore((state) => state.addNotification)
  const addToast = useAppStore((state) => state.addToast)

  const [amount, setAmount] = useState(500)
  const [upiId, setUpiId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // For V1: earned balance = balance - 100 (signup bonus)
  // This is a client-side approximation; server does the real check
  const signupBonus = 100
  const earnedBalance = Math.max(0, balance - signupBonus)
  const canWithdraw = earnedBalance >= 500

  const handleWithdraw = async () => {
    setError('')

    if (!canWithdraw) return
    if (amount < 500) {
      setError('Minimum withdrawal is Rs 500')
      return
    }
    if (amount > balance) {
      setError('Amount exceeds your balance')
      return
    }
    if (!upiId.trim()) {
      setError('Please enter your UPI ID')
      return
    }
    if (!/^[a-zA-Z0-9.\-_]+@[a-zA-Z]+$/.test(upiId.trim())) {
      setError('Invalid UPI ID format. Expected: name@bank (e.g., rahul@paytm)')
      return
    }

    setLoading(true)

    try {
      const result = await createWithdrawalRequest({
        amount,
        upiId: upiId.trim(),
      })

      if (result && !result.ok) {
        setError(String(result.error ?? 'Failed to submit withdrawal request'))
        setLoading(false)
        return
      }

      if (!result) {
        setError('Network error. Please try again.')
        setLoading(false)
        return
      }

      addNotification({
        title: 'Withdrawal Requested',
        text: `Your withdrawal of Rs ${amount} has been submitted. We'll process it within 24-48 hours.`,
        icon: '🏦',
      })

      addToast('Withdrawal request submitted successfully', 'success')
      setSuccess(true)
      setLoading(false)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="screen" style={{ paddingBottom: 20 }}>
        <div className="app-header">
          <div className="header-content">
            <div className="header-left">
              <button className="back-btn" onClick={() => appNavigate('/wallet')}>
                ←
              </button>
              <div className="header-title">Withdraw</div>
            </div>
          </div>
        </div>

        <div className="container">
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2E7D32', marginBottom: 8 }}>
              Withdrawal Requested!
            </h2>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>
              Rs {amount} withdrawal to <strong>{upiId}</strong>
            </p>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>
              We'll process your withdrawal within 24-48 hours. You'll receive a notification when it's sent.
            </p>
            <button className="btn-primary" onClick={() => appNavigate('/wallet')}>
              BACK TO WALLET
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/wallet')}>
              ←
            </button>
            <div className="header-title">Withdraw</div>
          </div>
        </div>
      </div>

      <div className="container">
        {!canWithdraw ? (
          <>
            <div className="alert-box alert-error">
              <strong>Cannot Withdraw Yet</strong>
              <br />
              You need at least Rs 500 in earned balance (profits from trading). Your signup bonus of Rs 100 does not count.
              <br />
              <br />
              <span style={{ fontSize: 12 }}>
                Earned balance: <strong>Rs {earnedBalance.toFixed(0)}</strong> / Rs 500 needed
              </span>
            </div>
            <button className="btn-primary" onClick={() => appNavigate('/markets')}>
              TRADE TO EARN MORE
            </button>
          </>
        ) : (
          <>
            <div className="market-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: '#888' }}>Total Balance</span>
                <strong>Rs {balance.toFixed(0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ color: '#888' }}>Earned Balance</span>
                <strong style={{ color: '#2E7D32' }}>Rs {earnedBalance.toFixed(0)}</strong>
              </div>

              <div className="input-group">
                <label className="input-label">Withdraw Amount (Rs)</label>
                <input
                  type="number"
                  className="input-field"
                  value={amount}
                  onChange={(event) => setAmount(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
                  style={{ fontSize: 24, fontWeight: 700, textAlign: 'center' }}
                />
              </div>

              <div className="quick-amounts">
                <button className="quick-amount-btn" onClick={() => setAmount(500)}>
                  Rs 500
                </button>
                <button className="quick-amount-btn" onClick={() => setAmount(1000)}>
                  Rs 1000
                </button>
                <button className="quick-amount-btn" onClick={() => setAmount(2000)}>
                  Rs 2000
                </button>
                <button className="quick-amount-btn" onClick={() => setAmount(Math.floor(balance))}>
                  ALL
                </button>
              </div>
            </div>

            <div className="market-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#666', marginBottom: 12 }}>PAYMENT DETAILS</div>
              <div className="input-group">
                <label className="input-label">UPI ID</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="yourname@upi"
                  value={upiId}
                  onChange={(event) => setUpiId(event.target.value)}
                />
              </div>
              <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Enter your UPI ID (e.g., name@paytm, name@gpay, number@upi)
              </p>
            </div>

            {error ? (
              <div className="alert-box alert-error">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="loading-spinner" />
            ) : (
              <button
                className="btn-primary"
                onClick={handleWithdraw}
                disabled={amount < 500 || amount > balance || !upiId.trim()}
              >
                REQUEST WITHDRAWAL — Rs {amount}
              </button>
            )}

            <p style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 16 }}>
              Withdrawals are manually processed within 24-48 hours. Min: Rs 500 earned balance.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
