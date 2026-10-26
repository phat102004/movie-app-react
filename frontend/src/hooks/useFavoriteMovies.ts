import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { loadFavoriteMovies } from '../services/favoriteMovies'
import type { FavoriteMovieResult } from '../services/favoriteMovies'
import type { Movie } from '../types/movie'

export function useFavoriteMovies(ids: readonly number[]) {
  const { user, isSigningOut } = useAuth()
  const owner = !isSigningOut ? user?.id : undefined
  const idKey = ids.join(',')
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    owner?: string
    rows: Map<number, FavoriteMovieResult>
  }>({ rows: new Map() })
  const cache = useRef<{ owner?: string; movies: Map<number, Movie> }>({
    movies: new Map(),
  })

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    if (cache.current.owner !== owner)
      cache.current = { owner, movies: new Map() }
    const movieCache = cache.current.movies
    const requestedIds = idKey ? idKey.split(',').map(Number) : []
    const rows = new Map<number, FavoriteMovieResult>()
    for (const movieId of requestedIds) {
      const movie = movieCache.get(movieId)
      if (movie) rows.set(movieId, { movieId, movie, error: null })
    }
    async function load() {
      await Promise.resolve()
      if (controller.signal.aborted) return
      setState({ owner, rows })
      if (!owner) return
      await loadFavoriteMovies(
        requestedIds.filter((id) => !rows.has(id)),
        controller.signal,
        (result) => {
          if (!current) return
          if (result.movie) movieCache.set(result.movieId, result.movie)
          setState((previous) => ({
            owner,
            rows: new Map(previous.rows).set(result.movieId, result),
          }))
        },
      )
    }
    void load()
    return () => {
      current = false
      controller.abort()
    }
  }, [owner, idKey, revision])

  return {
    rows:
      state.owner === owner && owner
        ? state.rows
        : new Map<number, FavoriteMovieResult>(),
    retry: () => setRevision((value) => value + 1),
  }
}
