import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Icon } from '../components/Icon'
import { MovieDataState } from '../components/MovieDataState'
import { MovieList } from '../components/MovieList'
import { MovieTrailer } from '../components/MovieTrailer'
import { MovieCast } from '../components/MovieCast'
import { MovieLoadNotice } from '../components/MovieLoadNotice'
import { FavoriteButton } from '../components/FavoriteButton'
import { useMovieDetails } from '../hooks/useMovieDetails'
import { isValidMovieId } from '../utils/movieId'
import { tmdbImageSrcSet } from '../utils/responsiveImage'
import { NotFoundPage } from './NotFoundPage'
import './MovieDetailsPage.css'

const releaseStatuses: Record<string, string> = {
  Rumored: 'Tin đồn',
  Planned: 'Đã lên kế hoạch',
  'In Production': 'Đang sản xuất',
  'Post Production': 'Đang hậu kỳ',
  Released: 'Đã phát hành',
  Canceled: 'Đã hủy',
}

function DetailsImage({
  src,
  title,
  backdrop = false,
}: {
  src?: string
  title: string
  backdrop?: boolean
}) {
  const [failed, setFailed] = useState(false)
  return !src || failed ? (
    <div className="poster-fallback">
      <span>CINEVERSE</span>
      <strong>{title}</strong>
      <span>Chưa có hình ảnh</span>
    </div>
  ) : (
    <img
      src={src}
      srcSet={tmdbImageSrcSet(src, backdrop ? 'backdrop' : 'poster')}
      sizes={backdrop ? 'auto, (max-width: 760px) 100vw, 50vw' : '(max-width: 380px) 80px, (max-width: 760px) 110px, 220px'}
      alt={`${backdrop ? 'Khung hình từ' : 'Poster'} ${title}`}
      width={backdrop ? 1280 : 500}
      height={backdrop ? 720 : 750}
      loading={backdrop ? 'lazy' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

export function MovieDetailsPage() {
  const { movieId } = useParams<{ movieId: string }>()
  const { data: movie, isLoading, error, retry } = useMovieDetails(movieId)
  if (!isValidMovieId(movieId))
    return (
      <NotFoundPage
        title="ID phim không hợp lệ"
        message="ID phim trong đường dẫn phải là số nguyên dương hợp lệ. Ví dụ: /movies/27205."
      />
    )
  if (error?.status === 404)
    return (
      <NotFoundPage
        title="Không tìm thấy phim"
        message="TMDB không có bộ phim mang ID này. Phim có thể đã bị xóa hoặc đường dẫn chưa chính xác."
      />
    )
  if (error)
    return (
      <>
        <div className="details-navigation page-container">
          <Link to="/">← Về trang chủ</Link>
        </div>
        <MovieDataState
          status="error"
          message={error.message}
          onRetry={retry}
        />
      </>
    )
  if (isLoading || !movie)
    return (
      <section
        className="details-loading page-container"
        aria-busy="true"
        aria-label="Đang tải chi tiết phim"
      >
        <h1 className="visually-hidden">Đang tải chi tiết phim</h1>
        <p role="status">Đang tải chi tiết phim từ TMDB…</p>
        <div className="details-intro" aria-hidden="true">
          <div className="skeleton details-poster" />
          <div className="skeleton-lines">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        </div>
      </section>
    )

  const releaseDate = movie.releaseDate
    ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC' }).format(
        new Date(`${movie.releaseDate}T00:00:00Z`),
      )
    : 'Chưa có ngày phát hành'
  return (
    <article
      className="movie-details page-container"
      aria-labelledby="details-title"
    >
      <nav className="details-navigation" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link to="/">Trang chủ</Link>
          </li>
          <li aria-current="page">Chi tiết phim</li>
        </ol>
        <span>TMDB / {movie.id}</span>
      </nav>
      <MovieLoadNotice messages={movie.metadataWarnings ?? []} onRetry={retry} retryLabel="Thử lại" />
      <div className="details-intro">
        <figure className="details-poster">
          <DetailsImage
            key={`${movie.id}-poster`}
            src={movie.poster}
            title={movie.title}
          />
        </figure>
        <div className="details-copy">
          <p className="details-eyebrow">CINEVERSE / HỒ SƠ ĐIỆN ẢNH</p>
          <h1 id="details-title">{movie.title}</h1>
          <p className="details-original">
            <span>Tên gốc</span> {movie.originalTitle || 'Chưa có tên gốc'}
          </p>
          <div className="details-score">
            <Icon name="star" />
            <strong>
              {movie.rating === null ? 'Chưa có điểm' : movie.rating.toFixed(1)}
              {movie.rating !== null && <small> / 10</small>}
            </strong>
            <span>
              TMDB ·{' '}
              {movie.voteCount === null
                ? 'Chưa có số lượt đánh giá'
                : `${movie.voteCount.toLocaleString('vi-VN')} lượt đánh giá`}
            </span>
          </div>
          {movie.genres.length > 0 ? (
            <ul className="details-genres" aria-label="Thể loại">
              {movie.genres.map((genre) => (
                <li key={genre}>{genre}</li>
              ))}
            </ul>
          ) : (
            <p className="details-note">Chưa có thông tin thể loại.</p>
          )}
          <FavoriteButton
            key={movie.id}
            movieId={Number(movie.id)}
            title={movie.title}
          />
        </div>
        <div className="details-facts">
          <dl className="details-metadata">
            <div className="details-directors">
              <dt>Đạo diễn</dt>
              <dd>
                {movie.directors.map((director) => director.name).join(', ') ||
                  'Chưa có thông tin'}
              </dd>
            </div>
            <div>
              <dt>Ngày phát hành</dt>
              <dd>{releaseDate}</dd>
            </div>
            <div>
              <dt>Thời lượng</dt>
              <dd>
                {movie.runtime === null
                  ? 'Chưa có thời lượng'
                  : `${movie.runtime} phút`}
              </dd>
            </div>
            <div>
              <dt>Quốc gia sản xuất</dt>
              <dd>{movie.countries.join(', ') || 'Chưa có thông tin'}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>
                {releaseStatuses[movie.status] ??
                  (movie.status || 'Chưa có thông tin')}
              </dd>
            </div>
          </dl>
          <Link className="details-home-link" to="/">
            ← Tiếp tục khám phá
          </Link>
        </div>
      </div>
      <div className="details-story">
        <p className="details-eyebrow">CÂU CHUYỆN TRÊN MÀN ẢNH</p>
        <h2>Nội dung phim</h2>
        <p>
          {movie.description ||
            'TMDB chưa cung cấp mô tả nội dung cho phim này.'}
        </p>
      </div>
      <MovieCast key={`cast-${movie.id}`} cast={movie.cast} />
      <div
        className={`details-media ${movie.backdrop ? '' : 'details-media--trailer-only'}`}
      >
        {movie.backdrop && (
          <figure className="details-backdrop">
            <DetailsImage
              key={`${movie.id}-backdrop`}
              src={movie.backdrop}
              title={movie.title}
              backdrop
            />
            <figcaption>
              MỘT KHUNG HÌNH TỪ {movie.title.toLocaleUpperCase('vi-VN')}
            </figcaption>
          </figure>
        )}
        <MovieTrailer
          key={movie.id}
          movieTitle={movie.title}
          trailer={movie.trailer}
        />
      </div>
      {movie.recommendations.length > 0 && (
        <MovieList
          key={movie.id}
          id="recommendations"
          title="Có thể bạn sẽ thích"
          subtitle="Những câu chuyện tiếp theo, được gợi ý từ TMDB."
          movies={movie.recommendations}
          index={1}
        />
      )}
    </article>
  )
}
