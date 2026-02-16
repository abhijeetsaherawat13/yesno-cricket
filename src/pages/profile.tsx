import { useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { helpFaqs } from '../data/mockData'
import { useAppNavigation } from '../hooks/useAppNavigation'
import {
  fetchSnapshot,
  logoutRemote,
  syncKycComplete,
  syncProfile,
} from '../services/backend'
import { saveGatewayKyc, saveGatewayProfile } from '../services/gateway'
import { useAppStore } from '../store/useAppStore'
import type { Position } from '../types/app'

export function ProfilePage() {
  const appNavigate = useAppNavigation()
  const user = useAppStore((state) => state.user)
  const kycStatus = useAppStore((state) => state.kycStatus)
  const setModal = useAppStore((state) => state.setModal)
  const resetForLogout = useAppStore((state) => state.resetForLogout)

  const handleLogout = () => {
    setModal({
      title: 'Logout',
      text: 'Are you sure you want to logout?',
      actions: [
        { label: 'Cancel' },
        {
          label: 'Logout',
          primary: true,
          onClick: () => {
            void logoutRemote()
            resetForLogout()
            appNavigate('/auth/phone')
          },
        },
      ],
    })
  }

  return (
    <div className="screen">
      <div className="app-header">
        <div className="header-content">
          <div className="logo">
            <span>👤</span>
            <span>Profile</span>
          </div>
          <button className="icon-btn" onClick={() => appNavigate('/profile/settings')}>
            ⚙️
          </button>
        </div>
      </div>

      <div className="container">
        <div className="market-card profile-header">
          <div className="profile-avatar">{user?.name?.[0] ?? 'R'}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{user?.name ?? 'Rahul Kumar'}</div>
          <div style={{ fontSize: 13, color: '#888' }}>+91 {user?.phone ?? '98765 43210'}</div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 8 }}>
            {kycStatus === 'verified' ? (
              <span
                style={{
                  background: '#E8F5E9',
                  color: '#2E7D32',
                  padding: '4px 12px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ✓ KYC Verified
              </span>
            ) : (
              <span
                style={{
                  background: '#FFF3E0',
                  color: '#E65100',
                  padding: '4px 12px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                KYC Pending
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 12,
          }}
        >
          Account
        </div>

        <ProfileRow icon="📝" label="Edit Profile" onClick={() => appNavigate('/profile/edit')} />
        <ProfileRow icon="🪪" label="KYC Verification" onClick={() => appNavigate('/profile/kyc')} />
        <ProfileRow icon="📊" label="Trade History" onClick={() => appNavigate('/profile/history')} />
        <ProfileRow icon="🏆" label="Leaderboard" onClick={() => appNavigate('/leaderboard')} />

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: 1,
            margin: '24px 0 12px',
          }}
        >
          Support
        </div>

        <ProfileRow icon="💬" label="Help & Support" onClick={() => appNavigate('/profile/help')} />
        <ProfileRow icon="📄" label="Terms & Privacy" onClick={() => appNavigate('/profile/terms')} />
        <ProfileRow icon="⚙️" label="Settings" onClick={() => appNavigate('/profile/settings')} />
        <ProfileRow icon="🛡️" label="Admin Console" onClick={() => appNavigate('/admin')} />

        <button className="btn-danger" style={{ marginTop: 24 }} onClick={handleLogout}>
          LOGOUT
        </button>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: '#999' }}>Yes/No v1.0 · © 2026</div>
      </div>

      <BottomNav active="profile" />
    </div>
  )
}

function ProfileRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <div className="profile-item" onClick={onClick}>
      <div className="profile-item-left">
        <div className="profile-icon">{icon}</div>
        <div className="profile-item-text">{label}</div>
      </div>
      <div className="profile-item-arrow">›</div>
    </div>
  )
}

export function EditProfilePage() {
  const appNavigate = useAppNavigation()
  const user = useAppStore((state) => state.user)
  const updateState = useAppStore((state) => state.updateState)
  const addNotification = useAppStore((state) => state.addNotification)
  const addToast = useAppStore((state) => state.addToast)

  const [name, setName] = useState(user?.name ?? 'Rahul Kumar')
  const [email, setEmail] = useState(user?.email ?? '')
  const [loading, setLoading] = useState(false)

  const handleSave = () => {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addToast('Invalid email format', 'error')
      return
    }
    setLoading(true)

    window.setTimeout(() => {
      updateState({ user: { phone: user?.phone ?? '9876543210', name, email } })
      addNotification({ title: 'Profile Updated', text: 'Your profile has been saved', icon: '✅' })
      setLoading(false)

      void (async () => {
        try {
          // Save to gateway server (persists to Supabase)
          await saveGatewayProfile({ userId: user?.phone ?? '', name, email })

          // Also sync via legacy path if available
          await syncProfile(name, email)
          const snapshot = await fetchSnapshot()
          if (snapshot) {
            updateState({
              user: snapshot.user,
              balance: snapshot.balance,
              positions: snapshot.positions,
              transactions: snapshot.transactions,
              notifications: snapshot.notifications,
              kycStatus: snapshot.kycStatus,
            })
          }
        } catch {
          // Keep local state as fallback when remote sync fails.
        }
      })()

      appNavigate('/profile')
    }, 1000)
  }

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">Edit Profile</div>
          </div>
        </div>
      </div>

      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div className="profile-avatar" style={{ margin: '0 auto 12px' }}>
            {name[0] ?? 'R'}
          </div>
          <button
            style={{ background: 'none', border: 'none', color: '#2E7D32', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Change Photo
          </button>
        </div>

        <div className="market-card">
          <div className="input-group">
            <label className="input-label">Full Name</label>
            <input type="text" className="input-field" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="input-group">
            <label className="input-label">Email</label>
            <input
              type="email"
              className="input-field"
              placeholder="rahul@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Phone Number</label>
            <input
              type="tel"
              className="input-field"
              value={`+91 ${user?.phone ?? '9876543210'}`}
              disabled
              style={{ opacity: 0.6 }}
            />
            <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Phone number cannot be changed</p>
          </div>
        </div>

        {loading ? <div className="loading-spinner" /> : <button className="btn-primary" onClick={handleSave}>SAVE CHANGES</button>}
      </div>
    </div>
  )
}

type HistoryFilter = 'all' | 'open' | 'won' | 'lost' | 'void'

function historyCardClass(position: Position): string {
  if (position.status !== 'settled') return 'pos-card'
  if (position.outcome === 'win') return 'pos-card settled-win'
  if (position.outcome === 'lose') return 'pos-card settled-lose'
  return 'pos-card settled-void'
}

function filterPositions(positions: Position[], filter: HistoryFilter): Position[] {
  switch (filter) {
    case 'open':
      return positions.filter((p) => p.status === 'open')
    case 'won':
      return positions.filter((p) => p.status === 'settled' && p.outcome === 'win')
    case 'lost':
      return positions.filter((p) => p.status === 'settled' && p.outcome === 'lose')
    case 'void':
      return positions.filter((p) => p.status === 'settled' && p.outcome === 'void')
    default:
      return positions
  }
}

export function TradeHistoryPage() {
  const appNavigate = useAppNavigation()
  const positions = useAppStore((state) => state.positions)

  const [filter, setFilter] = useState<HistoryFilter>('all')
  const filtered = filterPositions(positions, filter)

  const tabs: { key: HistoryFilter; label: string }[] = [
    { key: 'all', label: `All (${positions.length})` },
    { key: 'open', label: `Open (${positions.filter((p) => p.status === 'open').length})` },
    { key: 'won', label: `Won (${positions.filter((p) => p.outcome === 'win').length})` },
    { key: 'lost', label: `Lost (${positions.filter((p) => p.outcome === 'lose').length})` },
    { key: 'void', label: `Void (${positions.filter((p) => p.outcome === 'void').length})` },
  ]

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">Trade History</div>
          </div>
        </div>
      </div>

      <div className="cat-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={`cat-tab ${filter === tab.key ? 'active' : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      <div className="container">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📈</div>
            <div className="empty-title">
              {filter === 'all' ? 'No trades yet' : `No ${filter} positions`}
            </div>
            <div className="empty-text">
              {filter === 'all'
                ? 'Your trade history will appear here'
                : 'Positions matching this filter will appear here'}
            </div>
            {filter === 'all' ? (
              <button
                className="btn-primary"
                style={{ marginTop: 20, maxWidth: 200 }}
                onClick={() => appNavigate('/markets')}
              >
                START TRADING
              </button>
            ) : null}
          </div>
        ) : (
          filtered.map((position) => (
            <div
              key={position.id}
              className={historyCardClass(position)}
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
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#888' }}>IF WIN</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#00C853' }}>
                      +Rs {(position.potentialPayout - position.cost).toFixed(0)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function KycPage() {
  const appNavigate = useAppNavigation()
  const kycStatus = useAppStore((state) => state.kycStatus)
  const updateState = useAppStore((state) => state.updateState)
  const addNotification = useAppStore((state) => state.addNotification)

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [panNumber, setPanNumber] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [holderName, setHolderName] = useState('')
  const [validationError, setValidationError] = useState('')

  const handleSubmit = () => {
    setLoading(true)

    window.setTimeout(() => {
      updateState({ kycStatus: 'verified' })
      addNotification({ title: 'KYC Verified!', text: 'Your account is now fully verified', icon: '✅' })
      setLoading(false)

      void (async () => {
        try {
          // Save KYC details to gateway server (persists to Supabase)
          const kycUserId = useAppStore.getState().user?.phone ?? ''
          await saveGatewayKyc({
            userId: kycUserId,
            pan: panNumber,
            aadhaar: aadhaarNumber.replace(/\s/g, ''),
            bankAccount,
            ifsc: ifscCode,
            holderName,
            status: 'verified',
          })

          // Also sync via legacy path if available
          await syncKycComplete()
          const snapshot = await fetchSnapshot()
          if (snapshot) {
            updateState({
              user: snapshot.user,
              balance: snapshot.balance,
              positions: snapshot.positions,
              transactions: snapshot.transactions,
              notifications: snapshot.notifications,
              kycStatus: snapshot.kycStatus,
            })
          }
        } catch {
          // Keep local state as fallback when remote sync fails.
        }
      })()

      appNavigate('/profile')
    }, 2000)
  }

  if (kycStatus === 'verified') {
    return (
      <div className="screen" style={{ paddingBottom: 20 }}>
        <div className="app-header">
          <div className="header-content">
            <div className="header-left">
              <button className="back-btn" onClick={() => appNavigate('/profile')}>
                ←
              </button>
              <div className="header-title">KYC Verification</div>
            </div>
          </div>
        </div>

        <div className="container">
          <div className="success-screen">
            <div className="success-icon">✅</div>
            <div className="success-title">KYC Verified!</div>
            <div className="success-text">Your account is fully verified. You can now withdraw funds.</div>
            <button className="btn-primary" onClick={() => appNavigate('/profile')}>
              BACK TO PROFILE
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
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">KYC Verification</div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="alert-box alert-success">
          <strong>Why KYC?</strong> KYC verification is required to withdraw funds and ensures a safe trading
          environment.
        </div>

        {[1, 2, 3].map((number) => (
          <div className="kyc-step" key={number}>
            <div className={`kyc-step-num ${step >= number ? 'active' : ''}`}>{step > number ? '✓' : number}</div>
            <div className="kyc-step-content">
              <div className="kyc-step-title">
                {number === 1 ? 'PAN Card' : number === 2 ? 'Aadhaar Card' : 'Bank Account'}
              </div>
              <div className="kyc-step-desc">
                {number === 1
                  ? 'Enter your PAN number for identity verification'
                  : number === 2
                    ? 'Verify your address with Aadhaar'
                    : 'Link your bank account for withdrawals'}
              </div>
            </div>
          </div>
        ))}

        <div className="market-card" style={{ marginTop: 16 }}>
          {step === 1 ? (
            <>
              <div className="input-group">
                <label className="input-label">PAN Number</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  value={panNumber}
                  onChange={(e) => { setPanNumber(e.target.value.toUpperCase()); setValidationError('') }}
                />
              </div>
              {validationError ? <div className="alert-box alert-error" style={{ marginBottom: 12 }}>{validationError}</div> : null}
              <button className="btn-primary" onClick={() => {
                if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
                  setValidationError('Invalid PAN format. Expected: ABCDE1234F')
                  return
                }
                setValidationError('')
                setStep(2)
              }}>
                VERIFY PAN
              </button>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="input-group">
                <label className="input-label">Aadhaar Number</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="1234 5678 9012"
                  maxLength={14}
                  value={aadhaarNumber}
                  onChange={(e) => { setAadhaarNumber(e.target.value); setValidationError('') }}
                />
              </div>
              {validationError ? <div className="alert-box alert-error" style={{ marginBottom: 12 }}>{validationError}</div> : null}
              <button className="btn-primary" onClick={() => {
                const digits = aadhaarNumber.replace(/\s/g, '')
                if (!/^\d{12}$/.test(digits)) {
                  setValidationError('Aadhaar must be exactly 12 digits')
                  return
                }
                setValidationError('')
                setStep(3)
              }}>
                VERIFY AADHAAR
              </button>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="input-group">
                <label className="input-label">Account Number</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Enter account number"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label className="input-label">IFSC Code</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="HDFC0001234"
                  maxLength={11}
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Account Holder Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="As per bank records"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                />
              </div>
              {loading ? (
                <div className="loading-spinner" />
              ) : (
                <button className="btn-primary" onClick={handleSubmit}>
                  COMPLETE KYC
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const appNavigate = useAppNavigation()
  const settings = useAppStore((state) => state.settings)
  const setSettings = useAppStore((state) => state.setSettings)
  const addToast = useAppStore((state) => state.addToast)

  const handleSettingsChange = (newSettings: Partial<typeof settings>) => {
    const updatedSettings = { ...settings, ...newSettings }
    setSettings(newSettings)
    // Persist to gateway server
    const userId = useAppStore.getState().user?.phone ?? ''
    void saveGatewayProfile({ userId, settings: updatedSettings })
  }

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">Settings</div>
          </div>
        </div>
      </div>

      <div className="container">
        <SectionTitle title="Notifications" />

        <div className="market-card">
          <ToggleRow
            label="Push Notifications"
            enabled={settings.notifications}
            onToggle={() => handleSettingsChange({ notifications: !settings.notifications })}
          />
          <ToggleRow label="Sound Effects" enabled={settings.sounds} onToggle={() => handleSettingsChange({ sounds: !settings.sounds })} />
        </div>

        <SectionTitle title="Security" />

        <div className="market-card">
          <ToggleRow
            label="Biometric Login"
            enabled={settings.biometric}
            onToggle={() => handleSettingsChange({ biometric: !settings.biometric })}
          />
          <div className="toggle-row" style={{ borderBottom: 'none' }}>
            <span className="toggle-label">Change PIN</span>
            <div style={{ color: '#2E7D32', fontWeight: 600, cursor: 'pointer' }} onClick={() => addToast('PIN management coming soon', 'info')}>Change ›</div>
          </div>
        </div>

        <SectionTitle title="App" />

        <div className="market-card">
          <div className="toggle-row">
            <span className="toggle-label">App Version</span>
            <span style={{ color: '#888' }}>1.0.0</span>
          </div>
          <div className="toggle-row" style={{ borderBottom: 'none' }}>
            <span className="toggle-label">Clear Cache</span>
            <div style={{ color: '#2E7D32', fontWeight: 600, cursor: 'pointer' }} onClick={() => {
              localStorage.removeItem('yesno-app-state-v1')
              addToast('Cache cleared. Reload to take effect.', 'success')
            }}>Clear ›</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 1,
        margin: '24px 0 12px',
      }}
    >
      {title}
    </div>
  )
}

function ToggleRow({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="toggle-row">
      <span className="toggle-label">{label}</span>
      <div className={`toggle ${enabled ? 'on' : ''}`} onClick={onToggle}>
        <div className="toggle-knob" />
      </div>
    </div>
  )
}

export function HelpPage() {
  const appNavigate = useAppNavigation()
  const addToast = useAppStore((state) => state.addToast)
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">Help & Support</div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="market-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Need Help?</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>Our support team is available 24/7</div>
          <button className="btn-primary" onClick={() => addToast('Chat support coming soon!', 'info')}>CHAT WITH US</button>
        </div>

        <SectionTitle title="FAQs" />

        {helpFaqs.map((faq, index) => (
          <div
            key={faq.q}
            className="market-card"
            style={{ cursor: 'pointer' }}
            onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{faq.q}</div>
              <span style={{ color: '#888', fontSize: 18 }}>{expandedFaq === index ? '−' : '+'}</span>
            </div>
            {expandedFaq === index ? (
              <div style={{ marginTop: 12, fontSize: 13, color: '#666', lineHeight: 1.5 }}>{faq.a}</div>
            ) : null}
          </div>
        ))}

        <SectionTitle title="Contact" />

        <div className="profile-item">
          <div className="profile-item-left">
            <div className="profile-icon">📧</div>
            <div className="profile-item-text">support@yesno.app</div>
          </div>
        </div>

        <div className="profile-item">
          <div className="profile-item-left">
            <div className="profile-icon">📞</div>
            <div className="profile-item-text">1800-123-4567</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TermsPage() {
  const appNavigate = useAppNavigation()
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy'>('terms')

  return (
    <div className="screen" style={{ paddingBottom: 20 }}>
      <div className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="back-btn" onClick={() => appNavigate('/profile')}>
              ←
            </button>
            <div className="header-title">Legal</div>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ padding: '0 16px' }}>
        <div className={`tab ${activeTab === 'terms' ? 'active' : ''}`} onClick={() => setActiveTab('terms')}>
          Terms of Service
        </div>
        <div className={`tab ${activeTab === 'privacy' ? 'active' : ''}`} onClick={() => setActiveTab('privacy')}>
          Privacy Policy
        </div>
      </div>

      <div className="container">
        {activeTab === 'terms' ? (
          <div className="market-card">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Terms of Service</h3>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>
              <p style={{ marginBottom: 12 }}>Last updated: January 2026</p>
              <p style={{ marginBottom: 12 }}>
                <strong>1. Eligibility</strong>
                <br />
                You must be 18 years or older to use Yes/No. By using our services, you confirm that you meet this
                requirement.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong>2. Account</strong>
                <br />
                You are responsible for maintaining the confidentiality of your account credentials and for all
                activities under your account.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong>3. Trading</strong>
                <br />
                All trades are final once confirmed. Prices are determined by market supply and demand.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong>4. Withdrawals</strong>
                <br />
                Minimum withdrawal is Rs 500. KYC verification is required for withdrawals.
              </p>
              <p>
                <strong>5. Prohibited Activities</strong>
                <br />
                Market manipulation, multiple accounts, and fraudulent activities are strictly prohibited.
              </p>
            </div>
          </div>
        ) : null}

        {activeTab === 'privacy' ? (
          <div className="market-card">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Privacy Policy</h3>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>
              <p style={{ marginBottom: 12 }}>Last updated: January 2026</p>
              <p style={{ marginBottom: 12 }}>
                <strong>Information We Collect</strong>
                <br />
                We collect personal information including your name, phone number, email, and KYC documents.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong>How We Use Your Information</strong>
                <br />
                Your information is used to provide our services, verify your identity, and communicate with you.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong>Data Security</strong>
                <br />
                We use industry-standard encryption and security measures to protect your data.
              </p>
              <p>
                <strong>Your Rights</strong>
                <br />
                You can request access to, correction of, or deletion of your personal data by contacting support.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
