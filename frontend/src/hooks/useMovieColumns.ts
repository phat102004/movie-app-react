import { useEffect, useState } from 'react'

// Một nguồn breakpoint cho cả số phim mỗi lần mở và số cột CSS Grid.
const breakpoints = [
  { query: '(min-width: 1280px)', columns: 5 },
  { query: '(min-width: 960px)', columns: 4 },
  { query: '(min-width: 640px)', columns: 3 },
]

function getColumns() {
  if (typeof window === 'undefined') return 2
  return (
    breakpoints.find(({ query }) => window.matchMedia(query).matches)
      ?.columns ?? 2
  )
}

export function useMovieColumns() {
  const [columns, setColumns] = useState(getColumns)

  useEffect(() => {
    const queries = breakpoints.map(({ query }) => window.matchMedia(query))
    const updateColumns = () => setColumns(getColumns())
    queries.forEach((query) => query.addEventListener('change', updateColumns))
    updateColumns()
    return () =>
      queries.forEach((query) =>
        query.removeEventListener('change', updateColumns),
      )
  }, [])

  return columns
}
