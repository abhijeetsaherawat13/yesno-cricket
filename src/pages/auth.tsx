import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useAppNavigation } from '../hooks/useAppNavigation'
import { fetchGatewayPortfolioSnapshot, sendOtp, verifyOtp } from '../services/backend'
import { useAppStore } from '../store/useAppStore'

export function SplashPage() {
  const appNavigate = useAppNavigation()
  const isLoggedIn = useAppStore((state) => state.isLoggedIn)

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      appNavigate(isLoggedIn ? '/markets' : '/auth/phone')
    }, 2000)

    return () => window.clearTimeout(timerId)
  }, [appNavigate, isLoggedIn])

  return (
    <div className="screen">
      <div className="onboard-bg" style={{ flexDirection: 'column' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 80, marginBottom: 24 }}>🏏</div>
          <h1 style={{ fontSize: 36, fontWeight: 700, marginBottom: 8, color: '#fff' }}>Yes/No</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.9)', marginBottom: 40 }}>
            Trade Cricket Outcomes
          </p>
          <div
            style={{
              background: 'rgba(255,255,255,0.2)',
              padding: 2,
              borderRadius: 20,
              maxWidth: 200,
              margin: '0 auto',
            }}
          >
            <div style={{ background: '#FFD700', height: 4, borderRadius: 20, width: '60%' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function PhonePage() {
  const appNavigate = useAppNavigation()
  const updateState = useAppStore((state) => state.updateState)
  const addTransaction = useAppStore((state) => state.addTransaction)
  const addNotification = useAppStore((state) => state.addNotification)

  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (phone.length >= 10) {
      setLoading(true)
      setErrorMessage(null)

      try {
        // Check if user already has data on server
        const existingPortfolio = await fetchGatewayPortfolioSnapshot(phone)

        if (existingPortfolio && existingPortfolio.balance > 0) {
          // Returning user - restore their data
          updateState({
            isLoggedIn: true,
            user: {
              phone,
              name: existingPortfolio.name ?? `User ${phone.slice(-4)}`,
              email: existingPortfolio.email ?? undefined,
            },
            balance: existingPortfolio.balance,
            positions: existingPortfolio.positions,
            transactions: existingPortfolio.transactions,
            kycStatus: existingPortfolio.kycStatus ?? 'pending',
            settings: existingPortfolio.settings ?? { notifications: true, sounds: true, biometric: false },
          })

          addNotification({
            title: 'Welcome back!',
            text: `Your balance: Rs ${existingPortfolio.balance}`,
            icon: '👋',
          })

          appNavigate('/markets')
        } else {
          // New user - give signup bonus
          updateState({
            isLoggedIn: true,
            user: { phone, name: `User ${phone.slice(-4)}` },
            balance: 100,
          })

          addTransaction({
            type: 'credit',
            amount: 100,
            description: 'Signup Bonus',
            icon: '🎁',
          })

          addNotification({
            title: 'Welcome!',
            text: 'Rs 100 bonus added to your wallet',
            icon: '🎉',
          })

          appNavigate('/auth/success')
        }
      } catch {
        setErrorMessage('Login failed. Please try again.')
      }

      setLoading(false)
    }
  }

  return (
    <div className="screen">
      <div className="onboard-bg">
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🏏</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8, color: '#fff' }}>
              Welcome to Yes/No
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>Get Rs 100 FREE to start trading!</p>
          </div>
          <div className="card-white">
            <div className="input-group">
              <label className="input-label">Phone Number</label>
              <input
                type="tel"
                className="input-field"
                placeholder="+91 9876543210"
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>
            <button className="btn-primary" onClick={handleSubmit} disabled={phone.length < 10 || loading}>
              {loading ? 'LOGGING IN...' : 'LOGIN'}
            </button>
            {errorMessage ? <div className="alert-box alert-error">{errorMessage}</div> : null}
            <p style={{ fontSize: 11, color: '#999', marginTop: 16, textAlign: 'center', lineHeight: 1.4 }}>
              By continuing, you agree to our Terms & Conditions and confirm you are 18+
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OtpPage() {
  const appNavigate = useAppNavigation()
  const routeData = useAppStore((state) => state.routeData)
  const updateState = useAppStore((state) => state.updateState)
  const addTransaction = useAppStore((state) => state.addTransaction)
  const addNotification = useAppStore((state) => state.addNotification)

  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      return
    }

    const nextOtp = [...otp]
    nextOtp[index] = value
    setOtp(nextOtp)

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handleVerify = async () => {
    const otpValue = otp.join('')
    if (otpValue.length !== 6) {
      return
    }

    setLoading(true)
    setErrorMessage(null)

    const response = await verifyOtp(routeData.phone ?? '9876543210', otpValue)
    setLoading(false)

    if (!response.ok) {
      setErrorMessage(response.error ?? 'OTP verification failed.')
      return
    }

    if (response.snapshot) {
      updateState({
        isLoggedIn: true,
        user: response.snapshot.user,
        balance: response.snapshot.balance,
        positions: response.snapshot.positions,
        transactions: response.snapshot.transactions,
        notifications: response.snapshot.notifications,
        kycStatus: response.snapshot.kycStatus,
      })
    } else {
      updateState({
        isLoggedIn: true,
        user: { phone: routeData.phone ?? '9876543210', name: 'Rahul Kumar' },
        balance: 100,
      })

      addTransaction({
        type: 'credit',
        amount: 100,
        description: 'Signup Bonus',
        icon: '🎁',
      })

      addNotification({
        title: 'Welcome!',
        text: 'Rs 100 bonus added to your wallet',
        icon: '🎉',
      })
    }

    appNavigate('/auth/success')
  }

  return (
    <div className="screen">
      <div className="onboard-bg">
        <div className="container">
          <button
            className="back-btn"
            onClick={() => appNavigate('/auth/phone')}
            style={{ marginBottom: 20, color: '#fff' }}
          >
            ←
          </button>
          <div className="card-white">
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Enter OTP</h2>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 24, textAlign: 'center' }}>
              Sent to <strong>+91 {routeData.phone ?? '9876543210'}</strong>
            </p>
            <div className="otp-container">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => {
                    inputRefs.current[index] = element
                  }}
                  type="text"
                  className="otp-digit"
                  maxLength={1}
                  value={digit}
                  onChange={(event) => handleOtpChange(index, event.target.value)}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                />
              ))}
            </div>
            <button className="btn-primary" onClick={handleVerify} disabled={otp.join('').length < 6 || loading}>
              VERIFY OTP
            </button>
            {errorMessage ? <div className="alert-box alert-error">{errorMessage}</div> : null}
            <p style={{ fontSize: 13, color: '#666', marginTop: 16, textAlign: 'center' }}>
              Did not get code?{' '}
              <strong
                style={{
                  color: resendCountdown > 0 ? '#999' : '#2E7D32',
                  cursor: resendCountdown > 0 ? 'default' : 'pointer',
                }}
                onClick={() => {
                  if (resendCountdown > 0) return
                  setResendCountdown(30)
                  setErrorMessage(null)
                  void sendOtp(routeData.phone ?? '9876543210').then((res) => {
                    if (!res.ok) setErrorMessage(res.error ?? 'Failed to resend OTP.')
                  })
                  const id = window.setInterval(() => {
                    setResendCountdown((prev) => {
                      if (prev <= 1) { window.clearInterval(id); return 0 }
                      return prev - 1
                    })
                  }, 1000)
                }}
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend'}
              </strong>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SignupSuccessPage() {
  const appNavigate = useAppNavigation()

  return (
    <div className="screen">
      <div className="container success-screen">
        <div className="success-icon">🎉</div>
        <div className="success-title">Welcome to Yes/No!</div>
        <div className="success-text">Rs 100 FREE added to your wallet</div>
        <div className="summary-box">
          <div className="summary-row">
            <span>Signup Bonus</span>
            <strong style={{ color: '#00C853' }}>+Rs 100</strong>
          </div>
          <div className="summary-row">
            <span>Your Balance</span>
            <strong style={{ color: '#2E7D32' }}>Rs 100</strong>
          </div>
        </div>
        <div className="alert-box">
          <strong>💡 Pro Tip:</strong> Min withdrawal is Rs 500. Trade to grow your balance!
        </div>
        <button className="btn-primary" onClick={() => appNavigate('/markets')}>
          START TRADING
        </button>
      </div>
    </div>
  )
}
