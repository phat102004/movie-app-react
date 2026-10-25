import './TmdbAttribution.css'

export function TmdbAttribution() {
  return (
    <section
      className="tmdb-attribution"
      aria-label="Nguồn dữ liệu và hình ảnh"
    >
      <a
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noreferrer"
        aria-label="The Movie Database"
      >
        <img src="/tmdb-logo.svg" alt="TMDB" />
      </a>
      <p>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </section>
  )
}
