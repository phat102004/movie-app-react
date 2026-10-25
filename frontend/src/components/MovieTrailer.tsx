import { useState } from 'react'
import type { MovieTrailer as Trailer } from '../types/movieDetails'
import { Icon } from './Icon'

type MovieTrailerProps = { trailer: Trailer | null; movieTitle: string }

export function MovieTrailer({ trailer, movieTitle }: MovieTrailerProps) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <section className="details-trailer" aria-labelledby="trailer-title">
      <p className="details-eyebrow">MỘT CÁI NHÌN ĐẦU TIÊN</p>
      <h2 id="trailer-title">Trailer phim</h2>
      <p className="details-note">
        Video giới thiệu phim từ TMDB. Đây không phải phim đầy đủ.
      </p>
      {trailer ? (
        <>
          <button
            type="button"
            className="button button-secondary"
            aria-expanded={isOpen}
            aria-controls="trailer-player"
            onClick={() => setIsOpen(!isOpen)}
          >
            <Icon name={isOpen ? 'close' : 'play'} />
            {isOpen ? 'Đóng trailer' : 'Xem trailer'}
          </button>
          <div id="trailer-player">
            {isOpen && (
              <div className="trailer-frame">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=0&rel=0`}
                  title={`Trailer ${movieTitle}: ${trailer.name}`}
                  allow="encrypted-media; picture-in-picture; fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            )}
          </div>
          <p className="details-note">
            {trailer.official ? 'Trailer chính thức' : 'Trailer'}
            {trailer.language ? ` · ${trailer.language.toUpperCase()}` : ''}
            {' · '}
            <a
              href={`https://www.youtube.com/watch?v=${trailer.key}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Mở trên YouTube
            </a>
          </p>
        </>
      ) : (
        <p className="details-unavailable">
          Chưa có trailer YouTube hợp lệ cho phim này trên TMDB.
        </p>
      )}
    </section>
  )
}
