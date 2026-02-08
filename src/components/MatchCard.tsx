import { useAppNavigation } from '../hooks/useAppNavigation'
import { toSparklinePoints } from '../lib/chartUtils'
import type { Match } from '../types/app'

interface MatchCardProps {
  match: Match
}

export function MatchCard({ match }: MatchCardProps) {
  const appNavigate = useAppNavigation()

  const sparkline = match.sparkline
  const hasSparkline = sparkline && sparkline.length >= 2
  const sparkLast = hasSparkline ? sparkline[sparkline.length - 1] : 0
  const sparkFirst = hasSparkline ? sparkline[0] : 0
  const sparkUp = sparkLast >= sparkFirst

  return (
    <div className="match-card">
      <div className="match-top">
        <div className="match-meta">
          {match.isLive ? (
            <span className="live-badge" style={{ marginRight: 6 }}>
              <span className="live-dot" /> LIVE
            </span>
          ) : (
            <span className="match-time-badge">{match.time}</span>
          )}
          <span>Rs {match.volume} Vol.</span>
        </div>
        <div className="game-view-link" onClick={() => appNavigate('/markets/game-view', { match })}>
          <span className="game-view-count">{match.marketsCount}</span>
          Game View ›
        </div>
      </div>
      <div className="match-teams">
        <div className="team-row">
          <span className="team-flag">{match.flagA}</span>
          <span className="team-code">{match.teamA}</span>
          <span className="team-name">{match.teamAFull}</span>
          <span className="team-score">
            {match.scoreA !== '0-0' ? match.scoreA : ''}
            {match.oversA ? <span className="team-score-sub"> ({match.oversA})</span> : null}
            {match.scoreA === '0-0' ? <span style={{ color: '#888', fontSize: 12 }}>0-0</span> : null}
          </span>
        </div>
        <div className="team-row">
          <span className="team-flag">{match.flagB}</span>
          <span className="team-code">{match.teamB}</span>
          <span className="team-name">{match.teamBFull}</span>
          <span className="team-score">
            {match.scoreB === 'Yet to bat' ? (
              <span style={{ color: '#888', fontSize: 12 }}>Yet to bat</span>
            ) : match.scoreB !== '0-0' ? (
              match.scoreB
            ) : (
              <span style={{ color: '#888', fontSize: 12 }}>0-0</span>
            )}
          </span>
        </div>
      </div>
      {hasSparkline ? (
        <div className="sparkline-wrap">
          <svg viewBox="0 0 120 32" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <polyline
              fill="none"
              stroke={sparkUp ? '#2E7D32' : '#D32F2F'}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={toSparklinePoints(sparkline)}
            />
          </svg>
        </div>
      ) : null}
      {match.statusText && match.isLive ? (
        <div className="match-status">{match.statusText}</div>
      ) : null}
      <div className="bet-buttons">
        <button className="bet-btn bet-btn-a" onClick={() => appNavigate('/trade/buy', { match, side: 'A' })}>
          <span>{match.teamA}</span>
          <span className="bet-btn-price">{match.priceA}p</span>
        </button>
        <button className="bet-btn bet-btn-b" onClick={() => appNavigate('/trade/buy', { match, side: 'B' })}>
          <span>{match.teamB}</span>
          <span className="bet-btn-price">{match.priceB}p</span>
        </button>
      </div>
    </div>
  )
}
