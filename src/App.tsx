import { Navigate, Route, Routes } from 'react-router-dom'
import { AppModal } from './components/AppModal'
import { ToastContainer } from './components/Toast'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useBackendBootstrap } from './hooks/useBackendBootstrap'
import { OtpPage, PhonePage, SignupSuccessPage, SplashPage } from './pages/auth'
import { AdminPage } from './pages/admin'
import { GameViewPage, MarketsPage, NotificationsPage, SearchPage } from './pages/markets'
import {
  EditProfilePage,
  HelpPage,
  KycPage,
  ProfilePage,
  SettingsPage,
  TermsPage,
  TradeHistoryPage,
} from './pages/profile'
import { LeaderboardPage } from './pages/leaderboard'
import { BuyPage, BuySuccessPage, SellPage } from './pages/trading'
import { WalletPage, WithdrawPage } from './pages/wallet'

function App() {
  useBackendBootstrap()

  return (
    <div className="app-container">
      <ConnectionStatus />
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<SplashPage />} />
        <Route path="/auth/phone" element={<PhonePage />} />
        <Route path="/auth/otp" element={<OtpPage />} />
        <Route path="/auth/success" element={<SignupSuccessPage />} />

        <Route
          path="/markets"
          element={
            <ProtectedRoute>
              <MarketsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/markets/search"
          element={
            <ProtectedRoute>
              <SearchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/markets/notifications"
          element={
            <ProtectedRoute>
              <NotificationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/markets/game-view"
          element={
            <ProtectedRoute>
              <GameViewPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/trade/buy"
          element={
            <ProtectedRoute>
              <BuyPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trade/success"
          element={
            <ProtectedRoute>
              <BuySuccessPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trade/sell"
          element={
            <ProtectedRoute>
              <SellPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/wallet"
          element={
            <ProtectedRoute>
              <WalletPage />
            </ProtectedRoute>
          }
        />
        {/* Deposit disabled for V1 — redirect to wallet */}
        <Route path="/wallet/deposit" element={<Navigate to="/wallet" replace />} />
        <Route
          path="/wallet/withdraw"
          element={
            <ProtectedRoute>
              <WithdrawPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/leaderboard"
          element={
            <ProtectedRoute>
              <LeaderboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/edit"
          element={
            <ProtectedRoute>
              <EditProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/history"
          element={
            <ProtectedRoute>
              <TradeHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/kyc"
          element={
            <ProtectedRoute>
              <KycPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/help"
          element={
            <ProtectedRoute>
              <HelpPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/terms"
          element={
            <ProtectedRoute>
              <TermsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>

      <AppModal />
      <ToastContainer />
    </div>
  )
}

export default App
