// Chỉ dùng khi kiểm thử dev; không import vào ứng dụng production.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useMovieDetails } from '../src/hooks/useMovieDetails'

const originalFetch = globalThis.fetch
const ignoreAbort = new URLSearchParams(location.search).has('ignoreAbort')
let aborted = 0
globalThis.fetch = (input, options) => {
  if (String(input).startsWith('/api/')) {
    options?.signal?.addEventListener('abort', () => {
      document.documentElement.dataset.aborted = String(++aborted)
    })
    if (ignoreAbort)
      return originalFetch(input, { ...options, signal: undefined })
  }
  return originalFetch(input, options)
}

export function HookReader({ id }: { id: string }) {
  const { data, error, isLoading, retry } = useMovieDetails(id)
  return (
    <>
      <button onClick={retry}>Thử lại hook</button>
      <output id="hook-status">
        {isLoading ? 'loading' : error ? 'error' : 'success'}
      </output>
      <output id="hook-result">{data?.id ?? 'empty'}</output>
    </>
  )
}

export function Harness() {
  const [id, setId] = useState('27205')
  const [mounted, setMounted] = useState(true)
  return (
    <>
      <button onClick={() => setId('27205')}>Phim 27205</button>
      <button onClick={() => setId('42')}>Phim 42</button>
      <button onClick={() => setId('invalid')}>ID sai</button>
      <button onClick={() => setMounted((value) => !value)}>
        Bật tắt hook
      </button>
      {mounted && <HookReader id={id} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
