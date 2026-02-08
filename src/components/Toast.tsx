import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { ToastVariant } from '../types/app'

export function ToastContainer() {
  const toasts = useAppStore((state) => state.toasts)
  const removeToast = useAppStore((state) => state.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastBubble
          key={toast.id}
          id={toast.id}
          message={toast.message}
          variant={toast.variant}
          onDismiss={removeToast}
        />
      ))}
    </div>
  )
}

function ToastBubble({
  id,
  message,
  variant,
  onDismiss,
}: {
  id: number
  message: string
  variant: ToastVariant
  onDismiss: (id: number) => void
}) {
  useEffect(() => {
    const timerId = window.setTimeout(() => onDismiss(id), 3000)
    return () => window.clearTimeout(timerId)
  }, [id, onDismiss])

  const icon = variant === 'success' ? '\u2713' : variant === 'error' ? '\u2717' : '\u2139'

  return (
    <div className={`toast toast-${variant}`} onClick={() => onDismiss(id)}>
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{message}</span>
    </div>
  )
}
