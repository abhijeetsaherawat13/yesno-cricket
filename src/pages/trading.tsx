import { useEffect, useState } from 'react'
import { matchesData } from '../data/mockData'
import { useAppNavigation } from '../hooks/useAppNavigation'
import { defaultChartSeries, toAreaPoints, toLinePoints } from '../lib/chartUtils'
import { fetchGatewayPortfolioSnapshot, fetchSnapshot, syncBuyTrade, syncSellTrade } from '../services/backend'
import { fetchGatewayHistory } from '../services/gateway'
import { useAppStore } from '../store/useAppStore'
import type { Position } from '../types/app'

export function BuyPage() {
  const appNavigate = useAppNavigation()
  const routeData = useAppStore((state) => state.routeData)
  const balance = useAppStore((state) => state.balance)
  const user = useAppStore((state) => state.user)
  const positions = useAppStore((state) => state.positions)
  const updateState = useAppStore((state) => state.updateState)
  const addTransaction = useAppStore((state) => state.addTransaction)
  const addNotification = useAppStore((state) => state.addNotification)
  const addToast = useAppStore((state) => state.addToast)

  const match = routeData.match ?? matchesData[0]
  const option = routeData.option
  const side = routeData.side

  const [buyMode, setBuyMode] = useState<'yes' | 'no'>('yes')
  const [amount, setAmount] = useState(50)
  const [submitting, setSubmitting] = useState(false)

  const basePrice = option?.price ?? (side === 'A' ? match.priceA : match.priceB)
  const price = buyMode === 'yes' ? basePrice : 100 - basePrice
  const marketId = routeData.market?.id ?? 1
  const marketTitle = routeData.market?.title ?? 'Match Winner'
  const optionLabel = option?.label ?? (side === 'A' ? match.teamA : match.teamB)

  const [chartSeries, setChartSeries] = useState<number[]>(defaultChartSeries(price))

  useEffect(() => {
    let isCancelled = false

    const loadHistory = async () => {
      const points = await fetchGatewayHistory({
        matchId: match.id,
        marketId,
        optionLabel,
        side: buyMode,
        rangeMinutes: 180,
      })

      if (isCancelled) {
        return
      }

      if (points && points.length >= 2) {
        const nextSeries = points.map((point) => Math.max(1, Math.min(99, Math.round(point.price)))).slice(-80)
        if (nextSeries.length >= 2) {
          setChartSeries(nextSeries)
          return
        }
      }

      setChartSeries(defaultChartSeries(price))
    }

    void loadHistory()
    const intervalId = window.setInterval(() => {
      void loadHistory()
    }, 30_000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [buyMode, marketId, match.id, optionLabel, price])

  const shares = Math.floor(amount / (price / 100))
  const payout = shares
  const profit = payout - amount
  const profitPct = amount > 0 ? Math.round((profit / amount) * 100) : 0
  const chartLow = Math.min(...chartSeries)
  const chartHigh = Math.max(...chartSeries)
  const chartFirst = chartSeries[0] ?? price
  const chartLast = chartSeries[chartSeries.length - 1] ?? price
  const chartDelta = chartLast - chartFirst
  const chartDeltaPct = chartFirst > 0 ? (chartDelta / chartFirst) * 100 : 0
  const linePoints = toLinePoints(chartSeries)
  const areaPoints = toAreaPoints(chartSeries)

  const handleBuy = () => {
    if (amount > balance || shares <= 0 || submitting) {
      return
    }

    setSubmitting(true)

    const position: Position = {
      id: Date.now(),
      matchId: match.id,
      marketId,
      match: `${match.teamA} vs ${match.teamB}`,
      market: marketTitle,
      option: optionLabel,
      side: buyMode,
      shares,
      avgPrice: price,
      cost: amount,
      potentialPayout: payout,
      status: 'open',
      isLive: match.isLive,
      timestamp: new Date().toISOString(),
    }

    const userId = user?.phone ?? user?.email ?? user?.name ?? 'guest'

    void (async () => {
      try {
        const result = await syncBuyTrade({
          position,
          amount,
          userId,
        })

        // Use the server-generated position (has the correct ID) if available
        const finalPosition = result.serverPosition ?? position
        const newBalance = result.balance ?? balance - amount

        updateState({
          balance: newBalance,
          positions: [...positions, finalPosition],
        })

        addTransaction({
          type: 'debit',
          amount,
          description: `Bought ${optionLabel} ${buyMode.toUpperCase()}`,
          icon: '📉',
        })

        addNotification({
          title: 'Position Opened!',
          text: `${shares} shares of ${optionLabel} @ ${price}p`,
          icon: '✅',
        })

        // Sync portfolio from gateway (in-memory) instead of Supabase
        const gwPortfolio = await fetchGatewayPortfolioSnapshot(userId)
        if (gwPortfolio) {
          updateState({
            balance: gwPortfolio.balance,
            positions: gwPortfolio.positions,
          })
        } else {
          const snapshot = await fetchSnapshot()
          if (snapshot) {
            updateState({
              balance: snapshot.balance,
              positions: snapshot.positions,
              transactions: snapshot.transactions,
              notifications: snapshot.notifications,
              kycStatus: snapshot.kycStatus,
              user: snapshot.user,
            })
          }
        }

        addToast(`Bought ${shares} shares of ${optionLabel}`, 'success')
        appNavigate('/trade/success', { position: finalPosition, match })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Trade failed — check balance or market status'
        addToast(msg, 'error')
      } finally {
        setSubmitting(false)
      }
    })()
  }

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/markets/game-view', { match })}>
              ←
            </button>
            <div className="header-title">{marketTitle}</div>
          </div>
          <div className="balance-chip" onClick={() => appNavigate('/wallet')}>
            Rs {balance.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="container">
        <div className="market-card" style={{ borderLeft: '4px solid #2E7D32' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Will {optionLabel} win?</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {match.teamA} vs {match.teamB} · {match.category} · {match.isLive ? 'Live' : match.time}
          </div>
        </div>

        <div className="market-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#1B5E20', lineHeight: 1 }}>{price}p</div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: chartDelta >= 0 ? '#00C853' : '#D32F2F',
                  marginTop: 4,
                }}
              >
                {chartDelta >= 0 ? '▲' : '▼'} {chartDelta >= 0 ? '+' : ''}
                {chartDelta}p ({chartDelta >= 0 ? '+' : ''}
                {chartDeltaPct.toFixed(1)}%)
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: '#888' }}>
              <div>
                High: <strong style={{ color: '#1a1a1a' }}>{chartHigh}p</strong>
              </div>
              <div>
                Low: <strong style={{ color: '#1a1a1a' }}>{chartLow}p</strong>
              </div>
            </div>
          </div>

          <div className="chart-container">
            <svg viewBox="0 0 300 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2E7D32" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#2E7D32" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <polyline
                fill="url(#chartGrad)"
                stroke="none"
                points={areaPoints}
              />
              <polyline
                fill="none"
                stroke="#2E7D32"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={linePoints}
              />
              <circle cx="300" cy={linePoints.split(' ').pop()?.split(',')[1] ?? '50'} r="3" fill="#2E7D32" />
            </svg>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              paddingTop: 12,
              borderTop: '1px solid #f0f0f0',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Volume</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Rs {routeData.market?.volume ?? match.volume}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Traders</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>156</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Last Trade</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{price}p</div>
            </div>
          </div>
        </div>

        <div className="buy-card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => setBuyMode('yes')}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                border: buyMode === 'yes' ? '2px solid #2E7D32' : '2px solid #e0e0e0',
                background: buyMode === 'yes' ? '#E8F5E9' : '#f5f5f5',
                color: buyMode === 'yes' ? '#1B5E20' : '#888',
              }}
            >
              BUY YES
            </button>
            <button
              onClick={() => setBuyMode('no')}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                border: buyMode === 'no' ? '2px solid #C62828' : '2px solid #e0e0e0',
                background: buyMode === 'no' ? '#FFEBEE' : '#f5f5f5',
                color: buyMode === 'no' ? '#C62828' : '#888',
              }}
            >
              BUY NO
            </button>
          </div>

          <div
            style={{
              fontSize: 12,
              color: buyMode === 'yes' ? '#1B5E20' : '#C62828',
              textTransform: 'uppercase',
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            {buyMode === 'yes'
              ? `Buy: ${optionLabel} to Win @ ${price}p`
              : `Buy: ${optionLabel} to Lose @ ${price}p`}
          </div>

          <div className="input-group">
            <label className="input-label">Amount (Rs)</label>
            <input
              type="number"
              className="input-field"
              value={amount}
              onChange={(event) => setAmount(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
            />
          </div>

          <div className="quick-amounts">
            {[25, 50, 75].map((value) => (
              <button key={value} className="quick-amount-btn" onClick={() => setAmount(value)}>
                Rs {value}
              </button>
            ))}
            <button className="quick-amount-btn" onClick={() => setAmount(Math.floor(balance))}>
              MAX
            </button>
          </div>

          <div className="summary-box">
            <div className="summary-row">
              <span>Shares</span>
              <strong>{shares}</strong>
            </div>
            <div className="summary-row">
              <span>Price/share</span>
              <strong>
                {price}p (Rs {(price / 100).toFixed(2)})
              </strong>
            </div>
            <div className="summary-row">
              <span>Payout if wins (Rs 1/share)</span>
              <strong style={{ color: '#00C853' }}>Rs {payout}</strong>
            </div>
            <div className="summary-row">
              <span>Profit</span>
              <strong style={{ color: '#00C853' }}>
                +Rs {profit} ({profitPct}%)
              </strong>
            </div>
          </div>

          {amount > balance ? (
            <div className="alert-box alert-error" style={{ marginTop: 12 }}>
              Insufficient balance. You have Rs {balance.toFixed(0)} available.
            </div>
          ) : null}

          <button
            className="btn-primary"
            onClick={handleBuy}
            disabled={amount <= 0 || amount > balance || shares <= 0 || submitting}
            style={{ marginTop: 12 }}
          >
            {submitting ? 'PLACING ORDER...' : `BUY ${shares} SHARES @ ${price}p`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function BuySuccessPage() {
  const appNavigate = useAppNavigation()
  const routeData = useAppStore((state) => state.routeData)
  const balance = useAppStore((state) => state.balance)

  const position = routeData.position

  return (
    <div className="screen">
      <div className="container success-screen">
        <div className="success-icon">✅</div>
        <div className="success-title">Position Opened!</div>
        <div className="success-text">Your trade is now active</div>

        <div className="summary-box">
          <div className="summary-row">
            <span>Market</span>
            <strong>{position?.option} to Win</strong>
          </div>
          <div className="summary-row">
            <span>Shares</span>
            <strong>
              {position?.shares} @ {position?.avgPrice}p
            </strong>
          </div>
          <div className="summary-row">
            <span>Cost</span>
            <strong>Rs {position?.cost?.toFixed(2)}</strong>
          </div>
          <div className="summary-row">
            <span>Payout if YES</span>
            <strong style={{ color: '#00C853' }}>
              Rs {position?.potentialPayout} (+Rs {position ? (position.potentialPayout - position.cost).toFixed(2) : 0})
            </strong>
          </div>
          <div className="summary-row">
            <span>Balance</span>
            <strong style={{ color: '#2E7D32' }}>Rs {balance.toFixed(2)}</strong>
          </div>
        </div>

        <button className="btn-primary" onClick={() => appNavigate('/wallet')}>
          VIEW WALLET
        </button>
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => appNavigate('/markets')}>
          TRADE MORE
        </button>
      </div>
    </div>
  )
}

export function SellPage() {
  const appNavigate = useAppNavigation()
  const routeData = useAppStore((state) => state.routeData)
  const user = useAppStore((state) => state.user)
  const balance = useAppStore((state) => state.balance)
  const positions = useAppStore((state) => state.positions)
  const updateState = useAppStore((state) => state.updateState)
  const addTransaction = useAppStore((state) => state.addTransaction)
  const addNotification = useAppStore((state) => state.addNotification)
  const addToast = useAppStore((state) => state.addToast)

  const selectedPosition = routeData.position ?? null

  const [sellShares, setSellShares] = useState(() => selectedPosition?.shares ?? 0)
  const [currentPrice] = useState(() =>
    selectedPosition ? selectedPosition.avgPrice + Math.floor(Math.random() * 10) - 5 : 0,
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!selectedPosition) {
      appNavigate('/wallet')
    }
  }, [appNavigate, selectedPosition])

  if (!selectedPosition) {
    return null
  }

  const sellValue = sellShares * (currentPrice / 100)
  const pnl = sellValue - sellShares * (selectedPosition.avgPrice / 100)

  const handleSell = () => {
    if (submitting || sellShares <= 0) {
      return
    }

    setSubmitting(true)

    const remainingShares = selectedPosition.shares - sellShares

    const userId = user?.phone ?? user?.email ?? user?.name ?? 'guest'

    void (async () => {
      try {
        await syncSellTrade({
          positionId: selectedPosition.id,
          sellShares,
          userId,
        })

        if (remainingShares <= 0) {
          updateState({
            balance: balance + sellValue,
            positions: positions.filter((item) => item.id !== selectedPosition.id),
          })
        } else {
          updateState({
            balance: balance + sellValue,
            positions: positions.map((item) =>
              item.id === selectedPosition.id
                ? {
                    ...item,
                    shares: remainingShares,
                    cost: item.cost * (remainingShares / item.shares),
                  }
                : item,
            ),
          })
        }

        addTransaction({
          type: 'credit',
          amount: sellValue,
          description: `Sold ${sellShares} shares of ${selectedPosition.option}`,
          icon: '📈',
        })

        addNotification({
          title: 'Position Closed!',
          text: `${pnl >= 0 ? 'Profit' : 'Loss'}: Rs ${Math.abs(pnl).toFixed(2)}`,
          icon: pnl >= 0 ? '🎉' : '📉',
        })

        // Sync portfolio from gateway (in-memory) instead of Supabase
        const gwPortfolio = await fetchGatewayPortfolioSnapshot(userId)
        if (gwPortfolio) {
          updateState({
            balance: gwPortfolio.balance,
            positions: gwPortfolio.positions,
          })
        } else {
          const snapshot = await fetchSnapshot()
          if (snapshot) {
            updateState({
              balance: snapshot.balance,
              positions: snapshot.positions,
              transactions: snapshot.transactions,
              notifications: snapshot.notifications,
              kycStatus: snapshot.kycStatus,
              user: snapshot.user,
            })
          }
        }

        addToast(`Sold ${sellShares} shares of ${selectedPosition.option}`, 'success')
        appNavigate('/wallet')
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unable to close position — try again'
        addToast(msg, 'error')
      } finally {
        setSubmitting(false)
      }
    })()
  }

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/wallet')}>
              ←
            </button>
            <div className="header-title">Sell Position</div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="market-card" style={{ borderLeft: `4px solid ${pnl >= 0 ? '#2E7D32' : '#D32F2F'}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            {selectedPosition.option} ({selectedPosition.side.toUpperCase()})
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {selectedPosition.match} · {selectedPosition.market}
          </div>
        </div>

        <div className="market-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Your Shares</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{selectedPosition.shares}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Avg Price</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{selectedPosition.avgPrice}p</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Current Price</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: currentPrice > selectedPosition.avgPrice ? '#00C853' : '#D32F2F',
                }}
              >
                {currentPrice}p
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Unrealized P&L</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: pnl >= 0 ? '#00C853' : '#D32F2F' }}>
                {pnl >= 0 ? '+' : ''}Rs {pnl.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        <div className="buy-card">
          <div className="input-group">
            <label className="input-label">Shares to Sell</label>
            <input
              type="number"
              className="input-field"
              value={sellShares}
              onChange={(event) =>
                setSellShares(
                  Math.min(selectedPosition.shares, Math.max(0, Number.parseInt(event.target.value, 10) || 0)),
                )
              }
            />
          </div>

          <div className="quick-amounts">
            <button
              className="quick-amount-btn"
              onClick={() => setSellShares(Math.ceil(selectedPosition.shares * 0.25))}
            >
              25%
            </button>
            <button
              className="quick-amount-btn"
              onClick={() => setSellShares(Math.ceil(selectedPosition.shares * 0.5))}
            >
              50%
            </button>
            <button
              className="quick-amount-btn"
              onClick={() => setSellShares(Math.ceil(selectedPosition.shares * 0.75))}
            >
              75%
            </button>
            <button className="quick-amount-btn" onClick={() => setSellShares(selectedPosition.shares)}>
              ALL
            </button>
          </div>

          <div className="summary-box">
            <div className="summary-row">
              <span>Sell Price</span>
              <strong>{currentPrice}p</strong>
            </div>
            <div className="summary-row">
              <span>Sell Value</span>
              <strong>Rs {sellValue.toFixed(2)}</strong>
            </div>
            <div className="summary-row">
              <span>P&L</span>
              <strong style={{ color: pnl >= 0 ? '#00C853' : '#D32F2F' }}>
                {pnl >= 0 ? '+' : ''}Rs {pnl.toFixed(2)}
              </strong>
            </div>
          </div>

          <button className="btn-danger" onClick={handleSell} disabled={sellShares <= 0 || submitting} style={{ marginTop: 12 }}>
            {submitting ? 'SUBMITTING...' : `SELL ${sellShares} SHARES`}
          </button>
        </div>
      </div>
    </div>
  )
}
