import type {
  CastMember,
  MovieDetails,
  MovieTrailer,
} from '../types/movieDetails.ts'
import type { TmdbGenre, TmdbMovieDetails, TmdbVideo } from '../types/tmdb.ts'
import { getImageUrl, mapTmdbMovie } from './mapTmdbMovie.ts'

export function selectTrailer(
  videos: readonly TmdbVideo[],
): MovieTrailer | null {
  const languageScore = (language: string | null) =>
    language === 'vi' ? 2 : language === 'en' ? 1 : 0
  const trailer = videos
    .filter(
      (video) =>
        video.site === 'YouTube' &&
        video.type === 'Trailer' &&
        /^[a-zA-Z0-9_-]{11}$/.test(video.key),
    )
    .sort(
      (a, b) =>
        Number(b.official) - Number(a.official) ||
        languageScore(b.iso_639_1) - languageScore(a.iso_639_1),
    )[0]
  return trailer
    ? {
        key: trailer.key,
        name: trailer.name,
        official: trailer.official,
        language: trailer.iso_639_1,
      }
    : null
}

export function mapTmdbMovieDetails(
  data: TmdbMovieDetails,
  genres: readonly TmdbGenre[],
): MovieDetails {
  const movie = mapTmdbMovie(data, data.genres)
  const genreNames = [
    ...new Map(
      [...genres, ...data.genres].map((genre) => [genre.id, genre]),
    ).values(),
  ]
  const recommendations = [
    ...new Map(
      data.recommendations.results
        .filter((item) => item.id !== data.id)
        .map((item) => [item.id, mapTmdbMovie(item, genreNames)]),
    ).values(),
  ]
  // Sort trên bản sao; diễn viên thiếu order nằm sau các vai có thứ tự rõ ràng.
  const orderedCast = [...data.credits.cast].sort((a, b) =>
    a.order === b.order ? 0 : (a.order ?? Infinity) - (b.order ?? Infinity),
  )
  const cast: CastMember[] = []
  const seenPeople = new Set<number>()
  for (const person of orderedCast) {
    if (seenPeople.has(person.id)) continue
    seenPeople.add(person.id)
    cast.push({
      id: person.id,
      name: person.name,
      character: person.character,
      profileUrl: getImageUrl(person.profile_path, 'w185'),
      order: person.order,
    })
  }
  const directors = [
    ...new Map(
      data.credits.crew
        .filter((person) => person.job === 'Director')
        .map((person) => [person.id, person]),
    ).values(),
  ]
  return {
    ...movie,
    metadataWarnings: data.metadataWarnings ?? [],
    releaseDate: movie.year !== null ? (data.release_date ?? null) : null,
    runtime: data.runtime && data.runtime > 0 ? data.runtime : null,
    voteCount: data.vote_count ?? null,
    countries: [
      ...new Set(
        data.production_countries
          .map((country) => country.name.trim())
          .filter(Boolean),
      ),
    ],
    status: data.status?.trim() || '',
    trailer: selectTrailer(data.videos.results),
    recommendations,
    cast,
    directors,
  }
}
