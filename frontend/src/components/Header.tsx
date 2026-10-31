import { useRef, useState } from 'react'
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
  const navigation = useRef<HTMLElement>(null)

  function closeMenu() {
    setIsMenuOpen(false)
  }

  return (
    <header
      className="site-header"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
          closeMenu()
      }}
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
          ref={navigation}
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
          <NavLink
            to="/favorites"
            className={({ isActive }) =>
              `nav-link ${isActive ? 'is-active' : ''}`
            }
            onClick={closeMenu}
          >
            Yêu thích
          </NavLink>
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
            onClick={() => {
              if (isMenuOpen) closeMenu()
              else {
                setIsMenuOpen(true)
                // The disclosure is earlier in DOM order than this button.
                // Put keyboard users inside it after the hidden links mount.
                requestAnimationFrame(() => navigation.current?.querySelector('a')?.focus())
              }
            }}
          >
            <Icon name={isMenuOpen ? 'close' : 'menu'} />
          </button>
        </div>
      </div>
    </header>
  )
}
