// Dev-only harness: kiểm tra response lỗi thời kể cả transport không tôn trọng AbortSignal.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../src/contexts/AuthProvider'
import { FavoritesProvider } from '../src/contexts/FavoritesProvider'
import { useAuth } from '../src/hooks/useAuth'
import { useFavorites } from '../src/hooks/useFavorites'

const original = globalThis.fetch
if (new URLSearchParams(location.search).has('ignoreAbort')) {
  globalThis.fetch = (url, init) => {
    init?.signal?.addEventListener('abort', () => {
      document.documentElement.dataset.aborted = 'true'
    })
    return original(url, { ...init, signal: undefined })
  }
}

export function Reader() {
  const auth = useAuth()
  const favorites = useFavorites()
  return (
    <>
      <output id="owner">{auth.user?.name ?? 'guest'}</output>
      <output id="status">{favorites.status}</output>
      <output id="ids">{[...favorites.favoriteIds].join(',')}</output>
      <output id="pending">{[...favorites.pendingIds].join(',')}</output>
      <output id="error">{favorites.error?.code ?? ''}</output>
      <button
        onClick={() =>
          void auth.login({
            email: 'a@fixture.test',
            password: 'Synthetic favorites password 123!',
          })
        }
      >
        Login A
      </button>
      <button
        onClick={() =>
          void auth.login({
            email: 'b@fixture.test',
            password: 'Synthetic favorites password 123!',
          })
        }
      >
        Login B
      </button>
      <button onClick={() => void auth.logout()}>Logout</button>
      <button
        onClick={() => {
          void favorites.addFavorite(550)
          void favorites.addFavorite(550)
        }}
      >
        Add twice
      </button>
      <button onClick={() => void favorites.removeFavorite(550)}>Remove</button>
      <button onClick={() => void favorites.addFavorite(551)}>Add other</button>
      <button onClick={favorites.reload}>Reload</button>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <FavoritesProvider>
        <Reader />
      </FavoritesProvider>
    </AuthProvider>
  </StrictMode>,
)
