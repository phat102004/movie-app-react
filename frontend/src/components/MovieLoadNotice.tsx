import './MovieLoadNotice.css'

export function MovieLoadNotice({ messages, onRetry, busy = false, retryLabel = 'Thử lại phần chưa tải' }: {
  messages: string[]
  onRetry: () => void
  busy?: boolean
  retryLabel?: string
}) {
  if (!messages.length) return null
  return (
    <aside className="movie-load-notice" aria-label="Dữ liệu phim chưa đầy đủ">
      <div role="status">
        {messages.map(message => <p key={message}>{message}</p>)}
      </div>
      <button type="button" className="button button-secondary" onClick={onRetry} disabled={busy}>
        {busy ? 'Đang thử lại…' : retryLabel}
      </button>
    </aside>
  )
}
