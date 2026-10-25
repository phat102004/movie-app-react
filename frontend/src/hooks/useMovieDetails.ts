import { useEffect, useState } from 'react'
import { ApiError, getGenres, getMovieDetails } from '../services/tmdb.ts'
import type { MovieDetails } from '../types/movieDetails.ts'
import { isValidMovieId } from '../utils/movieId.ts'
import { mapTmdbMovieDetails } from '../utils/mapTmdbMovieDetails.ts'

type DetailsState = {
  id: string
  version: number
  data: MovieDetails | null
  error: ApiError | null
}

export function useMovieDetails(movieId: string | undefined) {
  const [state, setState] = useState<DetailsState>({
    id: '',
    version: -1,
    data: null,
    error: null,
  })
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    if (!isValidMovieId(movieId)) return
    const id = movieId
    const controller = new AbortController()
    let isCurrent = true

    async function load() {
      try {
        const [details, genres] = await Promise.all([
          getMovieDetails(id, controller.signal),
          // Thể loại bổ sung cho MovieCard gợi ý. Lỗi này không chặn nội dung chính.
          getGenres(controller.signal).catch(() => []),
        ])
        if (isCurrent)
          setState({
            id,
            version: requestVersion,
            data: mapTmdbMovieDetails(details, genres),
            error: null,
          })
      } catch (cause) {
        if (isCurrent) {
          setState({
            id,
            version: requestVersion,
            data: null,
            error:
              cause instanceof ApiError
                ? cause
                : new ApiError(
                    'Không thể tải chi tiết phim. Vui lòng thử lại.',
                  ),
          })
          controller.abort()
        }
      }
    }
    void load()
    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [movieId, requestVersion])

  // ID mới không được hiển thị nội dung của ID cũ trước khi Effect chạy.
  const current =
    state.id === movieId && state.version === requestVersion ? state : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    isLoading: isValidMovieId(movieId) && current === null,
    retry: () => setRequestVersion((version) => version + 1),
  }
}
