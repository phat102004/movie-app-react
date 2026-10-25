export type Movie = {
  id: string
  title: string
  originalTitle: string
  year: number | null
  rating: number | null
  poster: string
  genres: string[]
  description: string
  backdrop?: string
}

export type MovieSection = {
  id: string
  title: string
  subtitle: string
  movies: Movie[]
}
