import { useState } from 'react'
import { Link } from 'react-router'
import type { Movie } from '../types/movie'
import { Icon } from './Icon'
import { FavoriteButton } from './FavoriteButton'
import { moviePosterSizes, tmdbImageSrcSet } from '../utils/responsiveImage'
import './MovieCard.css'

type MovieCardProps = {
  movie: Movie
}

export function MovieCard({ movie }: MovieCardProps) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <article className="movie-card">
      <Link
        className="movie-card-link"
        to={`/movies/${movie.id}`}
        aria-label={`Chi tiết ${movie.title}`}
      >
        <div className="movie-poster">
          {imageFailed || !movie.poster ? (
            <div className="poster-fallback">
              <span>CINEVERSE</span>
              <strong>{movie.title}</strong>
            </div>
          ) : (
            <img
              src={movie.poster}
              srcSet={tmdbImageSrcSet(movie.poster, 'poster')}
              sizes={moviePosterSizes}
              alt={`Poster ${movie.title}`}
              width="500"
              height="750"
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          )}
        </div>
        <h3 title={movie.title}>{movie.title}</h3>
        <span className="movie-original-title" title={movie.originalTitle}>
          {movie.originalTitle}
        </span>
        <div className="movie-card-meta">
          <span>{movie.year ?? 'Chưa có năm'}</span>
          <span className="movie-card-genre">
            {movie.genres[0] ?? 'Chưa có thể loại'}
          </span>
          <span
            className="movie-rating"
            aria-label={
              movie.rating === null
                ? 'Chưa có đánh giá'
                : `Đánh giá ${movie.rating.toFixed(1)} trên 10`
            }
          >
            <Icon name="star" />{' '}
            {movie.rating === null ? '—' : movie.rating.toFixed(1)}
          </span>
        </div>
      </Link>
      <FavoriteButton movieId={Number(movie.id)} title={movie.title} compact />
    </article>
  )
}
