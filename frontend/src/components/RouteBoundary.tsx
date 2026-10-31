import { Component } from 'react'
import type { ReactNode } from 'react'

// Lazy module downloads can fail (offline / an older deployment). Keep the shell
// usable and allow an explicit retry via a fresh document/module graph.
export class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed)
      return (
        <section className="movie-data-state page-container" aria-labelledby="route-error-title">
          <div className="api-message">
            <h1 id="route-error-title">Chưa thể tải trang</h1>
            <p role="alert">Kiểm tra kết nối rồi tải lại trang để thử lại.</p>
            <button className="button button-primary" type="button" onClick={() => window.location.reload()}>
              Tải lại trang
            </button>
          </div>
        </section>
      )
    return this.props.children
  }
}

export function RouteLoading() {
  return (
    <section className="movie-data-state page-container" aria-busy="true" aria-label="Đang tải trang">
      <h1 className="visually-hidden">Đang tải trang Cineverse</h1>
      <p role="status">Đang tải trang Cineverse…</p>
    </section>
  )
}
