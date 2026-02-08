import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AppModalState,
  AppSettings,
  KycStatus,
  NotificationItem,
  Position,
  RouteData,
  ToastItem,
  ToastVariant,
  Transaction,
  User,
} from '../types/app'

type StatePatch = Partial<{
  isLoggedIn: boolean
  user: User | null
  balance: number
  positions: Position[]
  transactions: Transaction[]
  notifications: NotificationItem[]
  kycStatus: KycStatus
  settings: AppSettings
}>

interface AppStore {
  isLoggedIn: boolean
  user: User | null
  balance: number
  positions: Position[]
  transactions: Transaction[]
  notifications: NotificationItem[]
  kycStatus: KycStatus
  settings: AppSettings
  routeData: RouteData
  modal: AppModalState | null
  toasts: ToastItem[]
  updateState: (updates: StatePatch) => void
  addTransaction: (transaction: Omit<Transaction, 'id' | 'timestamp'>) => void
  addNotification: (notification: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => void
  markAllNotificationsRead: () => void
  setRouteData: (routeData: RouteData) => void
  clearRouteData: () => void
  setModal: (modal: AppModalState | null) => void
  addToast: (message: string, variant: ToastVariant) => void
  removeToast: (id: number) => void
  setSettings: (settings: Partial<AppSettings>) => void
  resetForLogout: () => void
}

const defaultSettings: AppSettings = {
  notifications: true,
  sounds: true,
  biometric: false,
}

const initialState = {
  isLoggedIn: false,
  user: null,
  balance: 0,
  positions: [] as Position[],
  transactions: [] as Transaction[],
  notifications: [] as NotificationItem[],
  kycStatus: 'pending' as KycStatus,
  settings: defaultSettings,
  routeData: {} as RouteData,
  modal: null as AppModalState | null,
  toasts: [] as ToastItem[],
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...initialState,
      updateState: (updates) => {
        set((state) => ({
          ...state,
          ...updates,
          settings: updates.settings ? { ...state.settings, ...updates.settings } : state.settings,
        }))
      },
      addTransaction: (transaction) => {
        set((state) => ({
          transactions: [
            {
              id: Date.now(),
              timestamp: new Date().toISOString(),
              ...transaction,
            },
            ...state.transactions,
          ],
        }))
      },
      addNotification: (notification) => {
        set((state) => ({
          notifications: [
            {
              id: Date.now(),
              timestamp: new Date().toISOString(),
              read: false,
              ...notification,
            },
            ...state.notifications,
          ],
        }))
      },
      markAllNotificationsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((notification) => ({
            ...notification,
            read: true,
          })),
        }))
      },
      setRouteData: (routeData) => {
        set(() => ({ routeData }))
      },
      clearRouteData: () => {
        set(() => ({ routeData: {} }))
      },
      setModal: (modal) => {
        set(() => ({ modal }))
      },
      addToast: (message, variant) => {
        set((state) => {
          const toast: ToastItem = { id: Date.now(), message, variant }
          const next = [...state.toasts, toast]
          return { toasts: next.length > 3 ? next.slice(-3) : next }
        })
      },
      removeToast: (id) => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
      },
      setSettings: (settings) => {
        set((state) => ({ settings: { ...state.settings, ...settings } }))
      },
      resetForLogout: () => {
        set((state) => ({
          ...state,
          isLoggedIn: false,
          user: null,
          balance: 0,
          positions: [],
          transactions: [],
          notifications: [],
          kycStatus: 'pending',
          routeData: {},
          modal: null,
          toasts: [],
        }))
      },
    }),
    {
      name: 'yesno-app-state-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isLoggedIn: state.isLoggedIn,
        user: state.user,
        balance: state.balance,
        positions: state.positions,
        transactions: state.transactions,
        notifications: state.notifications,
        kycStatus: state.kycStatus,
        settings: state.settings,
      }),
    },
  ),
)
