import { useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { Header } from './components/Header'
import { RouteFocus } from './components/RouteFocus'
import { TmdbAttribution } from './components/TmdbAttribution'
import { HomePage } from './pages/HomePage'
import { MovieDetailsPage } from './pages/MovieDetailsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { clearResetToken } from './utils/resetToken'
import { AuthSessionNotice } from './components/AuthSessionNotice'
import { FavoritesNotice } from './components/FavoritesNotice'
import { FavoritesPage } from './pages/FavoritesPage'
import { defaultMovieFilters } from './data/movieFilters'
import { useMovies } from './hooks/useMovies'
import type { MovieFilterValues } from './types/movieFilters'

function App() {
  const { pathname, key } = useLocation()
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
      <a className="skip-link" href="#main-content">
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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route
            path="/reset-password"
            element={<ResetPasswordPage key={key} />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
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
