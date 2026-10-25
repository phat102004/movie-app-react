import type { Movie } from './movie.ts'

export type MovieTrailer = {
  key: string
  name: string
  official: boolean
  language: string | null
}

export type CastMember = {
  id: number
  name: string
  character: string
  profileUrl: string
  order: number | null
}

export type MovieDirector = { id: number; name: string; job: string }

export type MovieDetails = Movie & {
  releaseDate: string | null
  runtime: number | null
  voteCount: number | null
  countries: string[]
  status: string
  trailer: MovieTrailer | null
  recommendations: Movie[]
  cast: CastMember[]
  directors: MovieDirector[]
}
