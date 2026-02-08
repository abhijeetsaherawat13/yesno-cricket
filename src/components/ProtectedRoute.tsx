import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isLoggedIn = useAppStore((state) => state.isLoggedIn)

  if (!isLoggedIn) {
    return <Navigate to="/auth/phone" replace />
  }

  return children
}
