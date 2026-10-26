import { createContext } from 'react'
import type { Favorite } from '../types/favorites'
import type { FavoritesApiError } from '../services/favorites'

export type FavoritesContextValue = {
  favorites: readonly Favorite[]
  favoriteIds: ReadonlySet<number>
  status: 'guest' | 'loading' | 'ready' | 'error'
  error: FavoritesApiError | null
  pendingIds: ReadonlySet<number>
  isFavorite(movieId: number): boolean
  addFavorite(movieId: number): Promise<void>
  removeFavorite(movieId: number): Promise<void>
  reload(): void
}

export const FavoritesContext = createContext<FavoritesContextValue | null>(
  null,
)
