import { useEffect } from 'react'
import { useLocation } from 'react-router'

const pageTitles: Record<string, string> = {
  '/': 'Trang chủ',
  '/favorites': 'Phim yêu thích',
  '/profile': 'Hồ sơ cá nhân',
  '/login': 'Đăng nhập',
  '/register': 'Đăng ký',
  '/forgot-password': 'Quên mật khẩu',
  '/reset-password': 'Đặt lại mật khẩu',
}

export function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    const routePath = pathname.toLowerCase().replace(/\/+$/, '') || '/'
    const isMovie = routePath.startsWith('/movies/')
    const fallback = pageTitles[routePath] ?? (isMovie ? 'Chi tiết phim' : 'Không tìm thấy trang')
    const main = document.getElementById('main-content')
    function updateTitle() {
      // Lazy routes and movie data arrive after navigation. Observe only the
      // route's heading; never put account names or reset URL tokens in titles.
      const heading = main?.querySelector('#route-error-title, #not-found-title, #details-title, #data-state-title')
      const title = `${heading?.textContent?.trim() || fallback} | Cineverse`
      if (document.title !== title) document.title = title
    }
    updateTitle()
    if (!main || (!isMovie && pageTitles[routePath])) return
    const observer = new MutationObserver(updateTitle)
    observer.observe(main, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [pathname])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    // Tìm kiếm từ trang chi tiết chuyển về Home nhưng vẫn giữ con trỏ nhập.
    if (document.activeElement?.id !== 'movie-search')
      document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [pathname])
  return null
}
