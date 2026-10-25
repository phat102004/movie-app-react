export type MovieCategory = 'popular' | 'now_playing' | 'top_rated'

export type TmdbMovie = {
  id: number
  title?: string | null
  original_title?: string | null
  overview?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string | null
  vote_average?: number | null
  vote_count?: number | null
  genre_ids: number[]
}

export type TmdbMoviePage = {
  page: number
  results: TmdbMovie[]
}

export type TmdbGenre = { id: number; name: string }

export type TmdbVideo = {
  id: string
  key: string
  name: string
  site: string
  type: string
  official: boolean
  iso_639_1: string | null
}

export type TmdbCastMember = {
  id: number
  name: string
  character: string
  profile_path: string | null
  order: number | null
}

export type TmdbCrewMember = { id: number; name: string; job: string }
export type TmdbCredits = { cast: TmdbCastMember[]; crew: TmdbCrewMember[] }

export type TmdbMovieDetails = TmdbMovie & {
  genres: TmdbGenre[]
  runtime?: number | null
  status?: string | null
  production_countries: { iso_3166_1: string; name: string }[]
  videos: { results: TmdbVideo[] }
  recommendations: TmdbMoviePage
  credits: TmdbCredits
}
