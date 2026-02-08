import { useEffect } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { hydrateFromSession } from '../services/backend'
import {
  connectSocket,
  disconnectSocket,
  onPortfolioUpdate,
  onPositionSettled,
} from '../services/socket'

export function useBackendBootstrap() {
  const updateState = useAppStore((state) => state.updateState)
  const addNotification = useAppStore((state) => state.addNotification)

  useEffect(() => {
    let isCancelled = false
    const socketCleanups: Array<() => void> = []

    const load = async () => {
      const snapshot = await hydrateFromSession()
      if (isCancelled || !snapshot) {
        return
      }

      updateState({
        isLoggedIn: true,
        user: snapshot.user,
        balance: snapshot.balance,
        kycStatus: snapshot.kycStatus,
        positions: snapshot.positions,
        transactions: snapshot.transactions,
        notifications: snapshot.notifications,
      })

      // Establish Socket.io connection after hydration
      try {
        await connectSocket()

        // Global listener: portfolio updates (balance + positions)
        socketCleanups.push(
          onPortfolioUpdate((data) => {
            if (!isCancelled) {
              updateState({
                balance: data.balance,
                positions: data.positions,
              })
            }
          }),
        )

        // Global listener: position settlement notifications
        socketCleanups.push(
          onPositionSettled((data) => {
            if (!isCancelled) {
              addNotification({
                title: 'Match Settled!',
                text: `${data.winnerFull} won. Check your portfolio for settlement details.`,
                icon: '🏏',
              })
            }
          }),
        )
      } catch {
        // Socket connection failed — app continues with polling fallback
      }
    }

    void load()

    if (!isSupabaseConfigured || !supabase) {
      return () => {
        isCancelled = true
        for (const cleanup of socketCleanups) cleanup()
        disconnectSocket()
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session || isCancelled) {
        return
      }

      const snapshot = await hydrateFromSession()
      if (!snapshot || isCancelled) {
        return
      }

      updateState({
        isLoggedIn: true,
        user: snapshot.user,
        balance: snapshot.balance,
        kycStatus: snapshot.kycStatus,
        positions: snapshot.positions,
        transactions: snapshot.transactions,
        notifications: snapshot.notifications,
      })
    })

    return () => {
      isCancelled = true
      subscription.unsubscribe()
      for (const cleanup of socketCleanups) cleanup()
      disconnectSocket()
    }
  }, [updateState, addNotification])
}
