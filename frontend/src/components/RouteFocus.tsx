import { useEffect } from 'react'
import { useLocation } from 'react-router'

export function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    // Tìm kiếm từ trang chi tiết chuyển về Home nhưng vẫn giữ con trỏ nhập.
    if (document.activeElement?.id !== 'movie-search')
      document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [pathname])
  return null
}
