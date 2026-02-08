import { useEffect, useState } from 'react'
import { MatchCard } from '../components/MatchCard'
import { BottomNav } from '../components/BottomNav'
import { buildMarkets, matchesData } from '../data/mockData'
import { useAppNavigation } from '../hooks/useAppNavigation'
import { isGatewayEnabled, fetchRecentTrades, type RecentTrade } from '../services/gateway'
import { areLiveFeedsEnabled } from '../services/liveFeeds'
import {
  fetchMarketsForMatch,
  fetchMatches,
  subscribeToMatchMarketPrices,
} from '../services/backend'
import { isSocketAvailable, onMatchesUpdate } from '../services/socket'
import { useAppStore } from '../store/useAppStore'
import type { Match } from '../types/app'

function useMatchFeed() {
  const shouldBootEmpty = areLiveFeedsEnabled || isGatewayEnabled
  const [matches, setMatches] = useState<Match[]>(shouldBootEmpty ? [] : matchesData)
  const [feedStatus, setFeedStatus] = useState<'loading' | 'live' | 'demo' | 'empty'>(
    shouldBootEmpty ? 'loading' : 'demo',
  )
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [retryTrigger, setRetryTrigger] = useState(0)

  useEffect(() => {
    let isCancelled = false

    const applyMatches = (nextMatches: Match[]) => {
      if (isCancelled) return
      if (nextMatches.length > 0) {
        setMatches(nextMatches)
        setFeedStatus(shouldBootEmpty ? 'live' : 'demo')
        setLastUpdated(new Date())
      } else {
        setFeedStatus(shouldBootEmpty ? 'empty' : 'demo')
        if (!shouldBootEmpty) {
          setMatches(matchesData)
        }
      }
    }

    // Initial fetch on mount
    if (shouldBootEmpty) setFeedStatus('loading')
    void fetchMatches().then(applyMatches)

    let cleanupSocket: (() => void) | null = null
    let intervalId: number | null = null

    if (isSocketAvailable()) {
      // Socket.io real-time: listen for matches:update events
      cleanupSocket = onMatchesUpdate((data) => {
        if (data.matches) applyMatches(data.matches)
      })
    } else {
      // Fallback: 30s HTTP polling
      intervalId = window.setInterval(() => {
        void fetchMatches().then(applyMatches)
      }, 30_000)
    }

    return () => {
      isCancelled = true
      cleanupSocket?.()
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [shouldBootEmpty, retryTrigger])

  return { matches, feedStatus, lastUpdated, retry: () => setRetryTrigger((n) => n + 1) }
}

export function MarketsPage() {
  const appNavigate = useAppNavigation()
  const balance = useAppStore((state) => state.balance)
  const notifications = useAppStore((state) => state.notifications)
  const { matches, feedStatus, lastUpdated, retry } = useMatchFeed()

  const [activeCategory, setActiveCategory] = useState('All')
  const categories = ['All', 'Cricket', 'IPL', 'International', 'T20 Leagues']

  const unreadNotifications = notifications.filter((notification) => !notification.read).length

  const filteredMatches =
    activeCategory === 'All'
      ? matches
      : matches.filter(
          (match) => match.category === activeCategory || (activeCategory === 'Cricket' && match.category),
        )

  const liveMatches = filteredMatches.filter((match) => match.isLive)
  const upcomingMatches = filteredMatches.filter((match) => !match.isLive)

  return (
    <div className="screen">
      <div className="app-header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">Y/N</div>
            <span>Yes/No</span>
          </div>
          <div className="header-icons">
            <button className="icon-btn" onClick={() => appNavigate('/markets/search')}>
              🔍
            </button>
            <button className="icon-btn" onClick={() => appNavigate('/markets/notifications')}>
              🔔
              {unreadNotifications > 0 ? <span className="notif-badge">{unreadNotifications}</span> : null}
            </button>
            <div className="balance-chip" onClick={() => appNavigate('/wallet')}>
              Rs {balance.toFixed(0)}
            </div>
          </div>
        </div>
      </div>

      <div className="cat-tabs">
        {categories.map((category) => (
          <div
            key={category}
            className={`cat-tab ${activeCategory === category ? 'active' : ''}`}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </div>
        ))}
      </div>

      <div className="container">
        <div style={{ marginBottom: 12 }}>
          {feedStatus === 'loading' ? (
            <div className="alert-box">Fetching live cricket feed...</div>
          ) : null}
          {feedStatus === 'live' ? (
            <div className="alert-box" style={{ background: '#E8F5E9', borderColor: '#2E7D32', color: '#1B5E20' }}>
              Live cricket data + modeled odds
            </div>
          ) : null}
          {feedStatus === 'demo' ? <div className="alert-box">Demo mode (mock data)</div> : null}
          {feedStatus === 'empty' ? (
            <div className="alert-box alert-error">
              Live feed unavailable right now.{' '}
              <strong style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={retry}>
                Retry
              </strong>
            </div>
          ) : null}
        </div>

        {lastUpdated && feedStatus !== 'loading' ? (
          <div style={{ fontSize: 11, color: '#999', textAlign: 'right', marginBottom: 8 }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </div>
        ) : null}

        {liveMatches.length > 0 ? (
          <>
            <div className="section-label">
              <span className="live-badge">
                <span className="live-dot" /> LIVE
              </span>
            </div>
            {liveMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </>
        ) : null}

        {upcomingMatches.length > 0 ? (
          <>
            <div className="section-label">📅 Upcoming</div>
            {upcomingMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </>
        ) : null}
      </div>

      <BottomNav active="markets" />
    </div>
  )
}

export function SearchPage() {
  const appNavigate = useAppNavigation()
  const { matches } = useMatchFeed()
  const [query, setQuery] = useState('')

  const results =
    query.length > 0
      ? matches.filter(
          (match) =>
            match.teamA.toLowerCase().includes(query.toLowerCase()) ||
            match.teamB.toLowerCase().includes(query.toLowerCase()) ||
            match.teamAFull.toLowerCase().includes(query.toLowerCase()) ||
            match.teamBFull.toLowerCase().includes(query.toLowerCase()),
        )
      : []

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/markets')}>
              ←
            </button>
            <div className="header-title">Search</div>
          </div>
        </div>
      </div>

      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Search teams, matches..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>

      <div className="container">
        {query.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">Search Markets</div>
            <div className="empty-text">Find matches by team name</div>
          </div>
        ) : null}

        {query.length > 0 && results.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">😕</div>
            <div className="empty-title">No results found</div>
            <div className="empty-text">Try a different search term</div>
          </div>
        ) : null}

        {results.map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </div>
    </div>
  )
}

export function NotificationsPage() {
  const appNavigate = useAppNavigation()
  const notifications = useAppStore((state) => state.notifications)
  const markAllNotificationsRead = useAppStore((state) => state.markAllNotificationsRead)

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/markets')}>
              ←
            </button>
            <div className="header-title">Notifications</div>
          </div>
          {notifications.some((notification) => !notification.read) ? (
            <button
              style={{
                background: 'none',
                border: 'none',
                color: '#2E7D32',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
              onClick={markAllNotificationsRead}
            >
              Mark all read
            </button>
          ) : null}
        </div>
      </div>

      <div className="container">
        {notifications.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔔</div>
            <div className="empty-title">No notifications</div>
            <div className="empty-text">You are all caught up!</div>
          </div>
        ) : (
          notifications.map((notification) => (
            <div key={notification.id} className={`notif-item ${!notification.read ? 'unread' : ''}`}>
              <div className="notif-icon">{notification.icon || '📢'}</div>
              <div className="notif-content">
                <div className="notif-title">{notification.title}</div>
                <div className="notif-text">{notification.text}</div>
                <div className="notif-time">{new Date(notification.timestamp).toLocaleString()}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function parseScore(score: string): { runs: number; wickets: number } | null {
  const m = score.match(/^(\d+)\/(\d+)/)
  if (m) return { runs: Number(m[1]), wickets: Number(m[2]) }
  const runsOnly = score.match(/^(\d+)$/)
  if (runsOnly) return { runs: Number(runsOnly[1]), wickets: 10 }
  return null
}

function parseOvers(overs: string): number {
  const val = parseFloat(overs)
  if (isNaN(val)) return 0
  const whole = Math.floor(val)
  const balls = Math.round((val - whole) * 10)
  return whole + balls / 6
}

function computeRunRate(runs: number, overs: number): string {
  if (overs <= 0) return '0.00'
  return (runs / overs).toFixed(2)
}

function inferTotalOvers(matchType?: string, matchName?: string): number {
  const text = `${matchType ?? ''} ${matchName ?? ''}`.toLowerCase()
  if (text.includes('t20') || text.includes('20-20') || text.includes('ipl') || text.includes('bbl') || text.includes('psl') || text.includes('cpl')) return 20
  if (text.includes('odi') || text.includes('50') || text.includes('one day')) return 50
  if (text.includes('t10') || text.includes('10 ')) return 10
  return 20 // default to T20
}

function LiveScorecard({ match }: { match: Match }) {
  const scoreA = parseScore(match.scoreA)
  const scoreB = parseScore(match.scoreB)
  const oversANum = parseOvers(match.oversA)
  const oversBNum = parseOvers(match.oversB)
  const totalOvers = inferTotalOvers(match.matchType, match.matchName)

  // Determine batting team and progress
  const teamABatting = oversANum > 0 && (oversBNum === 0 || oversANum > oversBNum)
  const currentOvers = teamABatting ? oversANum : oversBNum
  const progressPct = totalOvers > 0 ? Math.min((currentOvers / totalOvers) * 100, 100) : 0

  // Run rates
  const rrA = scoreA ? computeRunRate(scoreA.runs, oversANum) : null
  const rrB = scoreB ? computeRunRate(scoreB.runs, oversBNum) : null

  // Chase info (2nd innings)
  const isChasing = scoreA && scoreB && oversBNum > 0
  let chaseInfo: string | null = null
  if (isChasing && scoreA && scoreB) {
    const target = scoreA.runs + 1
    const needed = target - scoreB.runs
    const ballsLeft = Math.max(0, Math.round((totalOvers - oversBNum) * 6))
    if (needed > 0 && ballsLeft > 0) {
      const reqRR = (needed / (ballsLeft / 6)).toFixed(2)
      chaseInfo = `Need ${needed} from ${ballsLeft} balls (RRR: ${reqRR})`
    } else if (needed <= 0) {
      chaseInfo = `${match.teamBFull} won`
    }
  }

  return (
    <div className="sc-card">
      {/* Series / Match Name */}
      {match.matchName ? (
        <div className="sc-series">{match.matchName}</div>
      ) : null}

      {/* Status text */}
      {match.statusText && match.isLive ? (
        <div className="sc-status">
          <span className="live-dot" style={{ background: '#FF5252', width: 6, height: 6 }} />
          {match.statusText}
        </div>
      ) : null}

      {/* Team A */}
      <div className="sc-team-row">
        <div className="sc-team-left">
          <span className="sc-flag">{match.flagA}</span>
          <div>
            <div className="sc-team-name">{match.teamAFull || match.teamA}</div>
            {match.oversA ? <div className="sc-overs">{match.oversA} ov</div> : null}
          </div>
        </div>
        <div className="sc-score-right">
          <div className="sc-score">{match.scoreA || 'Yet to bat'}</div>
          {rrA && oversANum > 0 ? <div className="sc-rr">RR: {rrA}</div> : null}
        </div>
      </div>

      {/* Team B */}
      <div className="sc-team-row">
        <div className="sc-team-left">
          <span className="sc-flag">{match.flagB}</span>
          <div>
            <div className="sc-team-name">{match.teamBFull || match.teamB}</div>
            {match.oversB ? <div className="sc-overs">{match.oversB} ov</div> : null}
          </div>
        </div>
        <div className="sc-score-right">
          <div className="sc-score">{match.scoreB || 'Yet to bat'}</div>
          {rrB && oversBNum > 0 ? <div className="sc-rr">RR: {rrB}</div> : null}
        </div>
      </div>

      {/* Overs progress bar */}
      {match.isLive && currentOvers > 0 ? (
        <div className="sc-progress-wrap">
          <div className="sc-progress-track">
            <div className="sc-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="sc-progress-label">
            {currentOvers.toFixed(1)} / {totalOvers} overs
          </div>
        </div>
      ) : null}

      {/* Chase info */}
      {chaseInfo ? (
        <div className="sc-chase">{chaseInfo}</div>
      ) : null}

      {/* Bottom: Volume + Prices */}
      <div className="sc-bottom">
        <div className="sc-vol">Vol: Rs {match.volume}</div>
        <div className="sc-prices">
          <span className="sc-price-yes">{match.teamA} {match.priceA}p</span>
          <span className="sc-price-no">{match.teamB} {match.priceB}p</span>
        </div>
      </div>
    </div>
  )
}

export function GameViewPage() {
  const appNavigate = useAppNavigation()
  const routeData = useAppStore((state) => state.routeData)
  const balance = useAppStore((state) => state.balance)
  const addToast = useAppStore((state) => state.addToast)
  const match = routeData.match ?? matchesData[0]
  const [matchState, setMatchState] = useState(match)

  const [activeTab, setActiveTab] = useState('all')

  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'winner', label: 'Winner' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'player', label: 'Player' },
    { id: 'wickets', label: 'Wickets' },
    { id: 'overbyover', label: 'Over by Over' },
    { id: 'oddeven', label: 'Odd/Even' },
  ]

  const [markets, setMarkets] = useState(() => buildMarkets(match))
  const [marketsLoading, setMarketsLoading] = useState(true)
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([])

  useEffect(() => {
    let isCancelled = false

    const refreshMatchAndMarkets = async () => {
      const nextMatches = await fetchMatches()
      const latestMatch = nextMatches.find((candidate) => candidate.id === match.id) ?? match

      if (!isCancelled) {
        setMatchState(latestMatch)
      }

      const nextMarkets = await fetchMarketsForMatch(latestMatch)
      if (!isCancelled) {
        setMarkets(nextMarkets)
        setMarketsLoading(false)
      }
    }

    // Initial data fetch
    void refreshMatchAndMarkets()

    // Fetch recent trades
    void fetchRecentTrades(match.id).then((trades) => {
      if (!isCancelled) setRecentTrades(trades)
    })

    let cleanupMatchSocket: (() => void) | null = null
    let intervalId: number | null = null

    if (isSocketAvailable()) {
      // Socket.io: listen for match state updates
      cleanupMatchSocket = onMatchesUpdate((data) => {
        if (!isCancelled && data.matches) {
          const latestMatch = data.matches.find((candidate) => candidate.id === match.id)
          if (latestMatch) {
            setMatchState(latestMatch)
          }
        }
      })
    } else {
      // Fallback: 30s HTTP polling
      intervalId = window.setInterval(() => {
        void refreshMatchAndMarkets()
        void fetchRecentTrades(match.id).then((trades) => {
          if (!isCancelled) setRecentTrades(trades)
        })
      }, 30_000)
    }

    // Market price subscription (now socket-aware via backend.ts)
    const unsubscribe = subscribeToMatchMarketPrices(match.id, (updatedMarkets) => {
      if (!isCancelled) {
        setMarkets(updatedMarkets)
      }
    })

    return () => {
      isCancelled = true
      cleanupMatchSocket?.()
      if (intervalId !== null) window.clearInterval(intervalId)
      unsubscribe()
    }
  }, [match])

  const filteredMarkets = activeTab === 'all' ? markets : markets.filter((market) => market.category === activeTab)

  return (
    <div className="screen">
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/markets')}>
              ←
            </button>
            <div style={{ fontSize: 13, color: '#888' }}>Cricket · {matchState.category}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="icon-btn"
              onClick={() => {
                const shareText = `${matchState.teamAFull} vs ${matchState.teamBFull} — ${matchState.teamA} ${matchState.priceA}p | ${matchState.teamB} ${matchState.priceB}p\nTrade live on YesNo!`
                const shareUrl = window.location.origin
                if (navigator.share) {
                  void navigator.share({ title: 'YesNo Cricket', text: shareText, url: shareUrl })
                } else {
                  void navigator.clipboard.writeText(`${shareText}\n${shareUrl}`).then(() => {
                    addToast('Link copied to clipboard!', 'info')
                  })
                }
              }}
            >
              📤
            </button>
            <div className="balance-chip" onClick={() => appNavigate('/wallet')}>
              Rs {balance.toFixed(0)}
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <LiveScorecard match={matchState} />

        <div className="gv-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`gv-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>

        {marketsLoading && filteredMarkets.length === 0 ? (
          <div className="loading-spinner" />
        ) : null}

        {!marketsLoading && filteredMarkets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <div className="empty-title">No markets available</div>
            <div className="empty-text">Markets for this match haven't been created yet</div>
          </div>
        ) : null}

        {filteredMarkets.map((market) => (
          <div key={market.id} className="market-card">
            <div className="market-title">{market.title}</div>
            <div className="market-vol">
              Rs {market.volume} Vol.
              {market.live ? (
                <span style={{ color: '#1B5E20', fontWeight: 600, marginLeft: 8 }}>Ball Running</span>
              ) : null}
            </div>
            <div className="market-options">
              {market.options.map((option, index) => (
                <button
                  key={`${market.id}-${index}`}
                  className={`market-opt-btn opt-${option.type}`}
                  onClick={() => appNavigate('/trade/buy', { match: matchState, market, option })}
                >
                  {option.label} <strong>{option.price}p</strong>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Trade Tape */}
        {recentTrades.length > 0 ? (
          <>
            <div className="section-label">📊 Recent Trades</div>
            <div className="market-card" style={{ padding: 0, overflow: 'hidden' }}>
              {recentTrades.map((trade, index) => (
                <div key={index} className="trade-tape-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`trade-side-badge ${trade.side === 'yes' ? 'trade-side-yes' : 'trade-side-no'}`}>
                      {trade.side.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{trade.optionLabel}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{trade.price}p</span>
                    <span style={{ fontSize: 12, color: '#888' }}>Rs {trade.amount}</span>
                    <span style={{ fontSize: 11, color: '#aaa' }}>{formatTradeTime(trade.at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <BottomNav active="" />
    </div>
  )
}

function formatTradeTime(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.floor(hrs / 24)}d`
  } catch {
    return ''
  }
}
