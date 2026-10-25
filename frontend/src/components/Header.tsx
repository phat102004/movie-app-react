import { useState } from 'react'
import { Link, NavLink } from 'react-router'
import { Icon } from './Icon'
import { SearchBar } from './SearchBar'
import { AccountMenu } from './AccountMenu'
import './Header.css'

type HeaderProps = {
  searchQuery: string
  onSearchQueryChange: (query: string) => void
}

export function Header({ searchQuery, onSearchQueryChange }: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  function closeMenu() {
    setIsMenuOpen(false)
  }

  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isMenuOpen) {
          closeMenu()
          document.getElementById('menu-toggle')?.focus()
        }
      }}
    >
      <div className="header-inner page-container">
        <Link
          className="brand"
          to="/"
          aria-label="Cineverse — Trang chủ"
          onClick={closeMenu}
        >
          CINE<span>VERSE</span>
          <span className="brand-dot">.</span>
        </Link>

        <nav
          id="main-navigation"
          className={`main-navigation ${isMenuOpen ? 'is-open' : ''}`}
          aria-label="Điều hướng chính"
        >
          <NavLink
            className={({ isActive }) =>
              `nav-link ${isActive ? 'is-active' : ''}`
            }
            to="/"
            end
            onClick={closeMenu}
          >
            Trang chủ
          </NavLink>
          <button
            className="nav-link"
            type="button"
            disabled
            title="Trang Phim lẻ sẽ được bổ sung sau"
          >
            Phim lẻ
          </button>
          <button
            className="nav-link"
            type="button"
            disabled
            title="Trang Phim bộ sẽ được bổ sung sau"
          >
            Phim bộ
          </button>
          <button
            className="nav-link"
            type="button"
            disabled
            title="Trang Yêu thích sẽ được bổ sung sau"
          >
            Yêu thích
          </button>
        </nav>

        <SearchBar query={searchQuery} onQueryChange={onSearchQueryChange} />
        <div className="header-actions">
          <AccountMenu />
          <button
            id="menu-toggle"
            className="icon-button menu-toggle"
            type="button"
            aria-label={isMenuOpen ? 'Đóng menu' : 'Mở menu'}
            aria-expanded={isMenuOpen}
            aria-controls="main-navigation"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <Icon name={isMenuOpen ? 'close' : 'menu'} />
          </button>
        </div>
      </div>
    </header>
  )
}
