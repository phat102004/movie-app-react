export type Favorite = { movieId: number; createdAt: string }
export type FavoritePage = { favorites: Favorite[]; nextCursor: string | null }

export type FavoritesApi = {
  listAll(signal?: AbortSignal): Promise<Favorite[]>
  add(movieId: number, signal?: AbortSignal): Promise<Favorite>
  remove(movieId: number, signal?: AbortSignal): Promise<void>
}
