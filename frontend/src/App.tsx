import { useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { Header } from './components/Header'
import { RouteFocus } from './components/RouteFocus'
import { TmdbAttribution } from './components/TmdbAttribution'
import { HomePage } from './pages/HomePage'
import { MovieDetailsPage } from './pages/MovieDetailsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { defaultMovieFilters } from './data/movieFilters'
import { useMovies } from './hooks/useMovies'
import type { MovieFilterValues } from './types/movieFilters'

function App() {
  const { pathname } = useLocation()
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
    <div id="home">
      <a className="skip-link" href="#main-content">
        Đi đến nội dung chính
      </a>
      <Header
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchChange}
      />
      <main id="main-content" tabIndex={-1}>
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
