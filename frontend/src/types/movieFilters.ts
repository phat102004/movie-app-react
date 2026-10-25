export type MovieSortOrder =
  'default' | 'year-desc' | 'year-asc' | 'rating-desc' | 'title-asc'

export type MovieFilterValues = {
  genre: string
  year: number | ''
  minRating: number
  sortBy: MovieSortOrder
}
