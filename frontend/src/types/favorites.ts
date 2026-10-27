export type Favorite = { movieId: number; createdAt: string }
export type FavoritePage = { favorites: Favorite[]; nextCursor: string | null }

export type FavoritesApi = {
  listAll(signal?: AbortSignal, expectedAccount?: string): Promise<Favorite[]>
  add(movieId: number, signal?: AbortSignal, expectedAccount?: string): Promise<Favorite>
  remove(movieId: number, signal?: AbortSignal, expectedAccount?: string): Promise<void>
}
