import { useEffect, useState } from 'react'
import {
  type ConnectionStatus as ConnectionStatusType,
  getConnectionStatus,
  onConnectionStatusChange,
} from '../services/socket'

const colors: Record<ConnectionStatusType, string> = {
  connecting: '#FFA000',
  disconnected: '#D32F2F',
  error: '#D32F2F',
  connected: '#2E7D32',
}

const labels: Record<ConnectionStatusType, string> = {
  connecting: 'Connecting...',
  disconnected: 'Reconnecting...',
  error: 'Connection lost',
  connected: '',
}

export function ConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatusType>(getConnectionStatus())

  useEffect(() => {
    return onConnectionStatusChange(setStatus)
  }, [])

  // Don't show anything when connected or before connection attempt
  if (status === 'connected' || status === 'disconnected') return null

  return (
    <div
      style={{
        background: colors[status],
        color: '#fff',
        textAlign: 'center',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 0',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
      }}
    >
      {labels[status]}
    </div>
  )
}
