import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'

function useCurrentLocation() {
  return useLocation()
}

export function RequireAuth() {
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const location = useCurrentLocation()

  if (!token || !user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  return <Outlet />
}

export function RequireAdmin() {
  const user = useAuthStore((state) => state.user)
  const location = useCurrentLocation()
  const notified = useRef(false)

  useEffect(() => {
    if (user && user.role !== 'admin' && !notified.current) {
      notified.current = true
      toast.error('需要管理员权限', {
        description: '当前账号无法访问系统管理。',
      })
    }
  }, [user])

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  if (user.role !== 'admin') {
    return <Navigate to="/market" replace />
  }

  return <Outlet />
}

export function GuestOnly() {
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)

  if (token || user) {
    return <Navigate to="/market" replace />
  }

  return <Outlet />
}
