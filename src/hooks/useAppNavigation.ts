import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import type { AppRoute, RouteData } from '../types/app'

export function useAppNavigation() {
  const navigate = useNavigate()
  const setRouteData = useAppStore((state) => state.setRouteData)

  return (to: AppRoute, data?: RouteData) => {
    if (data) {
      setRouteData(data)
    }
    navigate(to)
    window.scrollTo(0, 0)
  }
}
