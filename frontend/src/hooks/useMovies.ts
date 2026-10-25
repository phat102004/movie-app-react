import { useEffect, useRef, useState } from 'react'
import { ApiError, getGenres, getMoviePage } from '../services/tmdb.ts'
import { buildMovieCatalog } from '../utils/mapTmdbMovie.ts'
import type { MovieCatalog } from '../utils/mapTmdbMovie.ts'

export function useMovies(enabled = true) {
  const [catalog, setCatalog] = useState<MovieCatalog>({
    movies: [],
    sections: [],
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const successfulVersion = useRef<number | null>(null)

  useEffect(() => {
    // App giữ hook khi chuyển trang; chỉ tải khi vào trang chủ và chưa có dữ liệu.
    if (!enabled || successfulVersion.current === requestVersion) return
    const controller = new AbortController()
    let isCurrent = true

    async function loadMovies() {
      setIsLoading(true)
      setError(null)
      try {
        const [popular, nowPlaying, topRated, genres] = await Promise.all([
          getMoviePage('popular', controller.signal),
          getMoviePage('now_playing', controller.signal),
          getMoviePage('top_rated', controller.signal),
          getGenres(controller.signal),
        ])
        if (isCurrent) {
          setCatalog(buildMovieCatalog(popular, nowPlaying, topRated, genres))
          setLastUpdated(new Date())
          successfulVersion.current = requestVersion
        }
      } catch (cause) {
        if (isCurrent) {
          setError(
            cause instanceof ApiError
              ? cause.message
              : 'Không thể tải danh sách phim. Vui lòng thử lại.',
          )
          controller.abort()
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadMovies()
    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [requestVersion, enabled])

  function retry() {
    setRequestVersion((version) => version + 1)
  }

  return { ...catalog, isLoading, error, retry, lastUpdated }
}
