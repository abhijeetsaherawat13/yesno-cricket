import { useAppNavigation } from '../hooks/useAppNavigation'

type BottomTab = 'markets' | 'wallet' | 'leaderboard' | 'profile' | ''

interface BottomNavProps {
  active: BottomTab
}

export function BottomNav({ active }: BottomNavProps) {
  const appNavigate = useAppNavigation()

  return (
    <div className="bottom-nav">
      <div className={`nav-item ${active === 'markets' ? 'active' : ''}`} onClick={() => appNavigate('/markets')}>
        <div className="nav-icon">📊</div>
        <div>Markets</div>
      </div>
      <div className={`nav-item ${active === 'wallet' ? 'active' : ''}`} onClick={() => appNavigate('/wallet')}>
        <div className="nav-icon">💰</div>
        <div>Wallet</div>
      </div>
      <div className={`nav-item ${active === 'leaderboard' ? 'active' : ''}`} onClick={() => appNavigate('/leaderboard')}>
        <div className="nav-icon">🏆</div>
        <div>Leaders</div>
      </div>
      <div className={`nav-item ${active === 'profile' ? 'active' : ''}`} onClick={() => appNavigate('/profile')}>
        <div className="nav-icon">👤</div>
        <div>Profile</div>
      </div>
    </div>
  )
}
