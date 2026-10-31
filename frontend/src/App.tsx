import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { Header } from './components/Header'
import { RouteFocus } from './components/RouteFocus'
import { TmdbAttribution } from './components/TmdbAttribution'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RouteBoundary, RouteLoading } from './components/RouteBoundary'
import { clearResetToken } from './utils/resetToken'
import { AuthSessionNotice } from './components/AuthSessionNotice'
import { FavoritesNotice } from './components/FavoritesNotice'
import { defaultMovieFilters } from './data/movieFilters'
import { useMovies } from './hooks/useMovies'
import type { MovieFilterValues } from './types/movieFilters'
import { useAuth } from './hooks/useAuth'
import { hasPasswordChangedNotice } from './utils/passwordChangeForm'

// Declare lazy modules once, outside render, so state isn't reset on re-render.
const MovieDetailsPage = lazy(() =>
  import('./pages/MovieDetailsPage').then(module => ({ default: module.MovieDetailsPage })),
)
const FavoritesPage = lazy(() =>
  import('./pages/FavoritesPage').then(module => ({ default: module.FavoritesPage })),
)
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })),
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then(module => ({ default: module.LoginPage })),
)
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then(module => ({ default: module.RegisterPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then(module => ({ default: module.ForgotPasswordPage })),
)
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })),
)

function App() {
  const { pathname, key, state } = useLocation()
  const isAuthPage = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ].includes(pathname)
  useEffect(() => {
    if (pathname !== '/reset-password') clearResetToken()
  }, [pathname])
  const navigate = useNavigate()
  const { passwordChanged, acknowledgePasswordChange } = useAuth()
  useEffect(() => {
    if (!passwordChanged) return
    // Giữ cờ đến khi Router nhận location mới; không để Profile guest redirect mất notice.
    if (pathname === '/login' && hasPasswordChangedNotice(state))
      acknowledgePasswordChange()
    else
      void navigate('/login', {
        replace: true,
        state: { passwordChanged: true, from: '/profile' },
      })
  }, [passwordChanged, acknowledgePasswordChange, navigate, pathname, state])
  // Hook và State ở ngoài Routes nên không bị mất khi mở trang chi tiết.
  const catalog = useMovies(pathname === '/')
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState<MovieFilterValues>(defaultMovieFilters)

  function handleSearchChange(query: string) {
    setSearchQuery(query)
    if (pathname !== '/') void navigate('/')
  }

  function resetFilters() {
    setSearchQuery('')
    setFilters(defaultMovieFilters)
  }

  return (
    <div id="home" className="site-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          // A native fragment navigation drops Router history.state (return URL
          // and auth notices). Move focus without creating a history entry.
          event.preventDefault()
          const main = document.getElementById('main-content')
          main?.focus({ preventScroll: true })
          main?.scrollIntoView({ block: 'start', behavior: 'instant' })
        }}
      >
        Đi đến nội dung chính
      </a>
      <Header
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchChange}
      />
      <AuthSessionNotice />
      <FavoritesNotice />
      <main
        id="main-content"
        className={isAuthPage ? 'auth-main' : undefined}
        tabIndex={-1}
      >
        <RouteBoundary key={pathname}>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <HomePage
                    catalog={catalog}
                    searchQuery={searchQuery}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onReset={resetFilters}
                  />
                }
              />
              <Route path="/movies/:movieId" element={<MovieDetailsPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route
                path="/reset-password"
                element={<ResetPasswordPage key={key} />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </RouteBoundary>
      </main>
      <footer className="site-footer page-container">
        <span className="footer-brand">
          CINEVERSE<span>.</span>
        </span>
        <p>Một không gian dành cho những người yêu điện ảnh.</p>
        <span className="footer-caption">MỖI BỘ PHIM, MỘT THẾ GIỚI.</span>
        <TmdbAttribution />
      </footer>
      <RouteFocus />
    </div>
  )
}

export default App
