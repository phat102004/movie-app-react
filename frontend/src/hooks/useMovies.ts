import { useEffect, useRef, useState } from 'react'
import { ApiError, getGenres, getMoviePage } from '../services/tmdb.ts'
import { buildMovieCatalog } from '../utils/mapTmdbMovie.ts'
import type { MovieCatalog } from '../utils/mapTmdbMovie.ts'
import type { TmdbGenre, TmdbMoviePage, MovieCategory } from '../types/tmdb.ts'

type Resource = MovieCategory | 'genres'
type Resources = Partial<Record<MovieCategory, TmdbMoviePage>> & { genres?: TmdbGenre[] }
const keys: Resource[] = ['popular', 'now_playing', 'top_rated', 'genres']
const labels: Record<Resource, string> = { popular: 'Phim nổi bật', now_playing: 'Phim đang chiếu', top_rated: 'Phim được đánh giá cao', genres: 'Thể loại' }
const emptyPage: TmdbMoviePage = { page: 1, results: [] }

export function useMovies(enabled = true) {
  const [catalog, setCatalog] = useState<MovieCatalog>({ movies: [], sections: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partialErrors, setPartialErrors] = useState<string[]>([])
  const [requestVersion, setRequestVersion] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const completedVersion = useRef<number | null>(null)
  const resources = useRef<Resources>({})
  const hasFailures = useRef(false)

  useEffect(() => {
    if (!enabled || completedVersion.current === requestVersion) return
    const controller = new AbortController()
    let current = true
    const data: Resources = { ...resources.current }
    const missing = keys.filter(key => data[key] === undefined)
    setIsLoading(true)
    setError(null)
    async function load() {
      const outcomes = await Promise.allSettled(missing.map(key =>
        key === 'genres' ? getGenres(controller.signal) : getMoviePage(key, controller.signal),
      ))
      if (!current) return
      const failures: string[] = []
      let successes = 0
      for (const [index, result] of outcomes.entries()) {
        const key = missing[index]
        if (result.status === 'fulfilled') {
          if (key === 'genres') data.genres = result.value as TmdbGenre[]
          else data[key] = result.value as TmdbMoviePage
          successes++
        } else failures.push(labels[key] + ': ' + (result.reason instanceof ApiError
          ? result.reason.message : 'Không thể tải dữ liệu.'))
      }
      resources.current = data
      hasFailures.current = failures.length > 0
      completedVersion.current = requestVersion
      const hasPage = data.popular !== undefined || data.now_playing !== undefined || data.top_rated !== undefined
      setCatalog(buildMovieCatalog(data.popular ?? emptyPage, data.now_playing ?? emptyPage, data.top_rated ?? emptyPage, data.genres ?? []))
      setPartialErrors(failures)
      setError(hasPage ? null : failures.join(' '))
      if (hasPage && successes) setLastUpdated(new Date())
      setIsLoading(false)
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [requestVersion, enabled])

  function retry() {
    // A partial retry preserves healthy resources; an explicit full refresh can
    // still be triggered after a completely successful load (e.g. hook harness).
    if (!hasFailures.current) resources.current = {}
    setRequestVersion(version => version + 1)
  }
  return { ...catalog, isLoading, error, partialErrors, retry, lastUpdated }
}
