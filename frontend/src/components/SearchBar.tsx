import { useRef } from 'react'
import { Icon } from './Icon'
import './SearchBar.css'

type SearchBarProps = {
  query: string
  onQueryChange: (query: string) => void
}

export function SearchBar({ query, onQueryChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function clearSearch() {
    onQueryChange('')
    inputRef.current?.focus()
  }

  return (
    <form
      className="search-bar"
      role="search"
      aria-label="Tìm kiếm phim"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="search-label" htmlFor="movie-search">
        Tên phim
      </label>
      <Icon name="search" />
      <input
        ref={inputRef}
        id="movie-search"
        name="query"
        type="search"
        placeholder="Tìm tên phim…"
        autoComplete="off"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {query.length > 0 && (
        <button
          className="search-clear"
          type="button"
          aria-label="Xóa nội dung tìm kiếm"
          title="Xóa nội dung tìm kiếm"
          onClick={clearSearch}
        >
          <Icon name="close" />
        </button>
      )}
    </form>
  )
}
