import { useState } from 'react'
import type { Movie } from '../types/movie'
import { Link } from 'react-router'
import { Icon } from './Icon'
import { heroImageSizes, tmdbImageSrcSet } from '../utils/responsiveImage'
import './HeroBanner.css'

type HeroBannerProps = {
  movie: Movie
}

export function HeroBanner({ movie }: HeroBannerProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const image = movie.backdrop || movie.poster
  return (
    <section className="hero page-container" aria-labelledby="hero-title">
      <div className="hero-topline">
        <p className="hero-eyebrow">GÓC NHÌN CINEVERSE</p>
        <span className="hero-edition">TUYỂN CHỌN ĐIỆN ẢNH / 01</span>
      </div>

      <div className="hero-layout">
        <figure className="hero-visual">
          {image && !imageFailed ? (
            <img
              className="hero-backdrop"
              src={image}
              srcSet={tmdbImageSrcSet(image, movie.backdrop ? 'backdrop' : 'poster')}
              sizes={heroImageSizes}
              alt={`Khung hình từ ${movie.title}`}
              width="1280"
              height="720"
              fetchPriority="high"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="hero-backdrop poster-fallback">
              <span>CINEVERSE</span>
              <strong>{movie.title}</strong>
            </div>
          )}
          <figcaption className="hero-image-caption">
            <span>PHIM ĐƯỢC TUYỂN CHỌN</span>
            <span>
              {movie.year ?? 'Chưa có năm'} —{' '}
              {movie.genres[0] ?? 'Chưa có thể loại'}
            </span>
          </figcaption>
        </figure>

        <div className="hero-content">
          <p className="hero-kicker">ĐÁNG XEM, ĐÁNG NHỚ.</p>
          <h1 id="hero-title" className="hero-original-title">
            {movie.originalTitle || movie.title}
          </h1>
          <p className="hero-local-title">{movie.title}</p>
          <div className="hero-metadata">
            <span className="hero-rating">
              <Icon name="star" />{' '}
              {movie.rating === null
                ? 'Chưa có đánh giá'
                : movie.rating.toFixed(1)}
              {movie.rating !== null && <span>/ 10</span>}
            </span>
            <span className="metadata-dot" aria-hidden="true">
              ·
            </span>
            <span>{movie.year ?? 'Chưa có năm phát hành'}</span>
          </div>
          <ul className="hero-genres" aria-label="Thể loại">
            {movie.genres.map((genre) => (
              <li key={genre}>{genre}</li>
            ))}
          </ul>
          <p className="hero-description">
            {movie.description || 'Chưa có mô tả cho phim này.'}
          </p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              type="button"
              disabled
              title="Chức năng xem phim sẽ được bổ sung sau"
            >
              <Icon name="play" /> Xem ngay
            </button>
            <Link
              className="button button-secondary"
              to={`/movies/${movie.id}`}
            >
              <Icon name="info" /> Chi tiết
            </Link>
          </div>
        </div>
      </div>

      <div className="hero-bottom">
        <span className="hero-bottom-caption">
          Một khung hình. Một câu chuyện. Một góc nhìn mới.
        </span>
        <a className="hero-explore" href="#featured">
          Khám phá bộ sưu tập <Icon name="arrow" />
        </a>
      </div>
    </section>
  )
}
