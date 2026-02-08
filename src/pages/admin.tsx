import { useEffect, useMemo, useState } from 'react'
import { useAppNavigation } from '../hooks/useAppNavigation'
import {
  approveWithdrawal,
  fetchAdminOverview,
  fetchAdminWithdrawals,
  rejectWithdrawal,
  settleGatewayMatch,
  setGatewayMarketSuspended,
  setGatewayUserSuspended,
} from '../services/gateway'
import {
  isSocketAvailable,
  onAdminOverview,
  onAdminWithdrawalRequest,
} from '../services/socket'

interface MatchRow {
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
}

interface UserRow {
  userId: string
  balance: number
  suspended: boolean
  exposure: number
  openPositions: number
  lastSeenAt: string
}

interface AuditRow {
  id: string
  at: string
  type: string
  details: Record<string, unknown>
}

interface WithdrawalRow {
  id: number
  user_id: string
  amount: number
  status: 'pending' | 'approved' | 'rejected' | 'sent'
  upi_id: string | null
  bank_details: string | null
  admin_notes: string | null
  created_at: string
  profiles: { phone: string; full_name: string } | null
}

interface Overview {
  fetchedAt: string | null
  stale: boolean
  feedSource: string
  matches: MatchRow[]
  users: UserRow[]
  totals: {
    openPositions: number
    settledMatches: number
    audits: number
  }
  audits: AuditRow[]
}

export function AdminPage() {
  const appNavigate = useAppNavigation()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [workingKey, setWorkingKey] = useState('')
  const [error, setError] = useState('')

  const liveCount = useMemo(
    () => overview?.matches.filter((match) => match.isLive).length ?? 0,
    [overview],
  )

  useEffect(() => {
    let isCancelled = false

    const loadOverview = async () => {
      const [nextOverview, withdrawalPayload] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminWithdrawals(),
      ])

      if (isCancelled) {
        return
      }

      if (!nextOverview) {
        setError('Admin gateway unavailable. Set VITE_GATEWAY_ADMIN_KEY and ensure backend is running.')
        setLoading(false)
        return
      }

      setOverview(nextOverview as Overview)
      if (withdrawalPayload?.ok) {
        const requests = (withdrawalPayload as Record<string, unknown>).requests
        setWithdrawals(Array.isArray(requests) ? (requests as WithdrawalRow[]) : [])
      }
      setError('')
      setLoading(false)
    }

    // Initial fetch on mount
    void loadOverview()

    let cleanupOverview: (() => void) | null = null
    let cleanupWithdrawal: (() => void) | null = null
    let intervalId: number | null = null

    if (isSocketAvailable()) {
      // Socket.io real-time: listen for admin overview and withdrawal updates
      cleanupOverview = onAdminOverview((data) => {
        if (!isCancelled && data.overview) {
          setOverview(data.overview as unknown as Overview)
          setError('')
          setLoading(false)
        }
      })

      cleanupWithdrawal = onAdminWithdrawalRequest((data) => {
        if (!isCancelled && data.request) {
          setWithdrawals((prev) => [data.request as unknown as WithdrawalRow, ...prev])
        }
      })
    } else {
      // Fallback: 20s HTTP polling
      intervalId = window.setInterval(() => {
        void loadOverview()
      }, 20_000)
    }

    return () => {
      isCancelled = true
      cleanupOverview?.()
      cleanupWithdrawal?.()
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [])

  const withRefresh = async (key: string, task: () => Promise<unknown>) => {
    setWorkingKey(key)

    try {
      await task()
      const [refreshed, withdrawalPayload] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminWithdrawals(),
      ])
      if (refreshed) {
        setOverview(refreshed as Overview)
      }
      if (withdrawalPayload?.ok) {
        const requests = (withdrawalPayload as Record<string, unknown>).requests
        setWithdrawals(Array.isArray(requests) ? (requests as WithdrawalRow[]) : [])
      }
      setError('')
    } catch {
      setError('Action failed. Please retry.')
    } finally {
      setWorkingKey('')
    }
  }

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">Admin Console</div>
          </div>
        </div>
      </div>

      <div className="container">
        {loading ? <div className="loading-spinner" /> : null}

        {error ? <div className="alert-box alert-error">{error}</div> : null}

        {overview ? (
          <>
            <div className="market-card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Gateway Status</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 12 }}>
                <div>
                  <strong>Feed:</strong> {overview.feedSource}
                </div>
                <div>
                  <strong>Stale:</strong> {overview.stale ? 'Yes' : 'No'}
                </div>
                <div>
                  <strong>Live Matches:</strong> {liveCount}
                </div>
                <div>
                  <strong>Open Positions:</strong> {overview.totals.openPositions}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
                Last refresh: {overview.fetchedAt ? new Date(overview.fetchedAt).toLocaleString() : 'N/A'}
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 10 }}>
              Market Risk Controls
            </div>
            {overview.matches.map((match) => {
              const pauseKey = `match-${match.id}`
              const settleKey = `settle-${match.id}`

              return (
                <div key={match.id} className="market-card" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{match.label}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        {match.category} · {match.isLive ? 'LIVE' : 'Not live'} · Exposure Rs {match.matchExposure.toFixed(0)}
                      </div>
                      {match.reason ? <div style={{ fontSize: 11, color: '#D32F2F' }}>Reason: {match.reason}</div> : null}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, marginBottom: 6 }}>
                        Status:{' '}
                        <strong style={{ color: match.tradingStatus === 'open' ? '#2E7D32' : '#D32F2F' }}>
                          {match.tradingStatus.toUpperCase()}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="quick-amount-btn"
                          onClick={() =>
                            withRefresh(pauseKey, () =>
                              setGatewayMarketSuspended(
                                match.id,
                                match.tradingStatus === 'open',
                                match.tradingStatus === 'open' ? 'Manual risk pause' : '',
                              ),
                            )
                          }
                          disabled={workingKey === pauseKey}
                        >
                          {match.tradingStatus === 'open' ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          className="quick-amount-btn"
                          onClick={() => withRefresh(settleKey, () => settleGatewayMatch(match.id))}
                          disabled={workingKey === settleKey || match.settled}
                        >
                          {match.settled ? 'Settled' : 'Settle'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#888',
                textTransform: 'uppercase',
                margin: '20px 0 10px',
              }}
            >
              User Risk Controls
            </div>
            {overview.users.length === 0 ? (
              <div className="market-card" style={{ color: '#888', fontSize: 12 }}>
                No active users yet.
              </div>
            ) : (
              overview.users.map((user) => {
                const userKey = `user-${user.userId}`
                return (
                  <div key={user.userId} className="market-card" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{user.userId}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>
                          Bal Rs {user.balance.toFixed(0)} · Exposure Rs {user.exposure.toFixed(0)} · Open {user.openPositions}
                        </div>
                      </div>
                      <button
                        className="quick-amount-btn"
                        onClick={() =>
                          withRefresh(userKey, () =>
                            setGatewayUserSuspended(
                              user.userId,
                              !user.suspended,
                              user.suspended ? '' : 'Manual risk suspension',
                            ),
                          )
                        }
                        disabled={workingKey === userKey}
                      >
                        {user.suspended ? 'Unsuspend' : 'Suspend'}
                      </button>
                    </div>
                  </div>
                )
              })
            )}

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#888',
                textTransform: 'uppercase',
                margin: '20px 0 10px',
              }}
            >
              Withdrawal Queue {withdrawals.length > 0 ? `(${withdrawals.length})` : ''}
            </div>
            {withdrawals.length === 0 ? (
              <div className="market-card" style={{ color: '#888', fontSize: 12 }}>
                No pending withdrawal requests.
              </div>
            ) : (
              withdrawals.map((wr) => {
                const approveKey = `wr-approve-${wr.id}`
                const rejectKey = `wr-reject-${wr.id}`
                return (
                  <div key={wr.id} className="market-card" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#D32F2F' }}>
                          Rs {wr.amount}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                          {wr.profiles?.full_name ?? 'Unknown'} · {wr.profiles?.phone ?? wr.user_id.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: 12, color: '#2E7D32', marginTop: 4 }}>
                          {wr.upi_id ? `UPI: ${wr.upi_id}` : wr.bank_details ?? 'No payment details'}
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>
                          {new Date(wr.created_at).toLocaleString()} · Status: {wr.status.toUpperCase()}
                        </div>
                      </div>
                      {wr.status === 'pending' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <button
                            className="quick-amount-btn"
                            style={{ background: '#E8F5E9', color: '#2E7D32', fontWeight: 700, fontSize: 12 }}
                            onClick={() => withRefresh(approveKey, () => approveWithdrawal(wr.id))}
                            disabled={workingKey === approveKey}
                          >
                            {workingKey === approveKey ? '...' : 'Approve'}
                          </button>
                          <button
                            className="quick-amount-btn"
                            style={{ background: '#FFEBEE', color: '#C62828', fontWeight: 700, fontSize: 12 }}
                            onClick={() => withRefresh(rejectKey, () => rejectWithdrawal(wr.id))}
                            disabled={workingKey === rejectKey}
                          >
                            {workingKey === rejectKey ? '...' : 'Reject'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#888',
                textTransform: 'uppercase',
                margin: '20px 0 10px',
              }}
            >
              Audit Trail
            </div>
            <div className="market-card" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {overview.audits.slice(0, 50).map((audit) => (
                <div key={audit.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{audit.type}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>{new Date(audit.at).toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{JSON.stringify(audit.details)}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
