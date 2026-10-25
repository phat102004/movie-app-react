// Harness kiểm thử trong dev; không import vào ứng dụng hay bản build production.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useMovies } from '../src/hooks/useMovies'

const originalFetch = globalThis.fetch
const ignoreAbort = new URLSearchParams(location.search).has('ignoreAbort')
let aborted = 0
globalThis.fetch = (input, options) => {
  if (String(input).startsWith('/api/')) {
    options?.signal?.addEventListener('abort', () => {
      document.documentElement.dataset.aborted = String(++aborted)
    })
    // Chủ động bỏ qua signal để kiểm tra guard isCurrent với kết quả đến muộn.
    if (ignoreAbort)
      return originalFetch(input, { ...options, signal: undefined })
  }
  return originalFetch(input, options)
}

export function HookReader() {
  const { movies, isLoading, error, retry } = useMovies()
  return (
    <>
      <button onClick={retry}>Thử lại hook</button>
      <output id="hook-status">
        {isLoading ? 'loading' : error ? 'error' : 'success'}
      </output>
      <output id="hook-result">{movies[0]?.originalTitle ?? 'empty'}</output>
    </>
  )
}

export function Harness() {
  const [mounted, setMounted] = useState(true)
  return (
    <>
      <button onClick={() => setMounted((value) => !value)}>
        Bật tắt hook
      </button>
      {mounted && <HookReader />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
