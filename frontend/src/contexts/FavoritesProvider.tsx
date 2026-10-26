import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import { FavoritesContext } from './favorites-context'
import type { Favorite, FavoritesApi } from '../types/favorites'
import {
  asFavoritesError,
  favoritesService,
  FavoritesApiError,
} from '../services/favorites'

export function FavoritesProvider({
  children,
  service = favoritesService,
}: {
  children: ReactNode
  service?: FavoritesApi
}) {
  const { user, status: authStatus, isSigningOut, refreshUser } = useAuth()
  const owner =
    authStatus === 'authenticated' && !isSigningOut ? user?.id : undefined
  const active = !!owner
  const authPending =
    authStatus === 'loading' || authStatus === 'error' || isSigningOut
  const [storedOwner, setStoredOwner] = useState(owner)
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [status, setStatus] = useState<'guest' | 'loading' | 'ready' | 'error'>(
    active ? 'loading' : 'guest',
  )
  const [error, setError] = useState<FavoritesApiError | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const alive = useRef(false)
  const requests = useRef(new Map<number, AbortController>())
  const loading = useRef(true)
  const ready = useRef(false)

  useEffect(() => {
    alive.current = true
    const current = ++generation.current
    const controller = new AbortController()
    const mutations = requests.current
    loading.current = active
    ready.current = false
    async function load() {
      // StrictMode cleanup có thể hủy lượt đầu trước khi tạo HTTP request.
      await Promise.resolve()
      if (controller.signal.aborted) return
      setStoredOwner(owner)
      setFavorites([])
      setPendingIds(new Set())
      setError(null)
      setStatus(active ? 'loading' : 'guest')
      if (!active) return
      try {
        const rows = await service.listAll(controller.signal)
        if (alive.current && generation.current === current) {
          setFavorites(rows)
          setStatus('ready')
          ready.current = true
        }
      } catch (cause) {
        if (
          alive.current &&
          generation.current === current &&
          !controller.signal.aborted
        ) {
          const failure = asFavoritesError(cause)
          setFavorites([])
          setError(failure)
          setStatus('error')
          if (failure.status === 401) void refreshUser()
        }
      } finally {
        if (generation.current === current) loading.current = false
      }
    }
    void load()
    return () => {
      alive.current = false
      controller.abort()
      for (const request of mutations.values()) request.abort()
      mutations.clear()
    }
  }, [owner, active, service, revision, refreshUser])

  function reload() {
    if (
      !active ||
      storedOwner !== owner ||
      loading.current ||
      requests.current.size
    )
      return
    loading.current = true
    ready.current = false
    setFavorites([])
    setStatus('loading')
    setError(null)
    setRevision((value) => value + 1)
  }

  async function update(movieId: number, add: boolean) {
    if (
      !active ||
      storedOwner !== owner ||
      !ready.current ||
      loading.current ||
      requests.current.has(movieId)
    )
      return
    const current = generation.current
    const controller = new AbortController()
    requests.current.set(movieId, controller)
    setPendingIds(new Set(requests.current.keys()))
    setError(null)
    try {
      const row = add
        ? await service.add(movieId, controller.signal)
        : (await service.remove(movieId, controller.signal), null)
      if (!alive.current || generation.current !== current) return
      // Pessimistic update: chỉ đổi trái tim sau response thành công.
      setFavorites((previous) => {
        const next = previous.filter((favorite) => favorite.movieId !== movieId)
        if (row) next.push(row)
        return next.sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.movieId - a.movieId,
        )
      })
    } catch (cause) {
      if (
        alive.current &&
        generation.current === current &&
        !controller.signal.aborted
      ) {
        const failure = asFavoritesError(cause)
        setError(failure)
        if (failure.status === 401) {
          // Một mutation mất phiên: không để các mutation khác tới muộn khôi phục state.
          ++generation.current
          for (const request of requests.current.values()) request.abort()
          requests.current.clear()
          setPendingIds(new Set())
          loading.current = false
          ready.current = false
          setFavorites([])
          setStatus('error')
          void refreshUser()
        }
      }
    } finally {
      if (alive.current && generation.current === current) {
        requests.current.delete(movieId)
        setPendingIds(new Set(requests.current.keys()))
      }
    }
  }

  // Che state của owner cũ ngay trong render, không đợi Effect; không remount App/Router.
  const matchingOwner = active && storedOwner === owner
  const visibleFavorites = matchingOwner ? favorites : []
  const favoriteIds = new Set(
    visibleFavorites.map((favorite) => favorite.movieId),
  )
  const visibleStatus = !active
    ? authPending
      ? 'loading'
      : 'guest'
    : !matchingOwner
      ? 'loading'
      : status
  return (
    <FavoritesContext.Provider
      value={{
        favorites: visibleFavorites,
        favoriteIds,
        pendingIds: matchingOwner ? pendingIds : new Set<number>(),
        status: visibleStatus,
        error: matchingOwner ? error : null,
        isFavorite: (id) => favoriteIds.has(id),
        addFavorite: (id) => update(id, true),
        removeFavorite: (id) => update(id, false),
        reload,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  )
}
