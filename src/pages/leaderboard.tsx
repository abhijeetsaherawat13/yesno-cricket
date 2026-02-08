import { useEffect, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { fetchLeaderboard } from '../services/gateway'
import type { LeaderboardEntry } from '../types/app'

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    void (async () => {
      const data = await fetchLeaderboard()
      if (!cancelled) {
        if (data === null) {
          setError(true)
        } else {
          setEntries(data)
        }
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [retryTrigger])

  return (
    <div className="screen">
      <div className="app-header">
        <div className="header-content">
          <div className="logo">
            <span>🏆</span>
            <span>Leaderboard</span>
          </div>
        </div>
      </div>

      <div className="container">
        {loading ? (
          <div className="loading-spinner" />
        ) : error ? (
          <div className="empty-state">
            <div className="empty-icon">😕</div>
            <div className="empty-title">Could not load leaderboard</div>
            <div className="empty-text">Check your connection and try again</div>
            <button
              className="btn-primary"
              style={{ marginTop: 20, maxWidth: 200 }}
              onClick={() => setRetryTrigger((n) => n + 1)}
            >
              RETRY
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏆</div>
            <div className="empty-title">No traders yet</div>
            <div className="empty-text">The leaderboard will populate once trades are settled</div>
          </div>
        ) : (
          <div className="lb-card">
            {entries.map((entry) => (
              <div
                key={entry.userId}
                className={`lb-row ${entry.isCurrentUser ? 'lb-current-user' : ''}`}
              >
                <div className={`lb-rank ${entry.rank <= 3 ? `lb-rank-${entry.rank}` : ''}`}>
                  {entry.rank}
                </div>
                <div className="lb-info">
                  <div className="lb-name">
                    {entry.isCurrentUser ? 'You' : entry.displayName}
                  </div>
                  <div className="lb-meta">
                    {entry.tradesCount} trades · {entry.winRate}% win rate
                  </div>
                </div>
                <div className={`lb-pnl ${entry.totalPnl >= 0 ? 'lb-positive' : 'lb-negative'}`}>
                  {entry.totalPnl >= 0 ? '+' : ''}Rs {entry.totalPnl}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="leaderboard" />
    </div>
  )
}
