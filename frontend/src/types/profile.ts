import type { AuthUser } from './auth'

export type Profile = AuthUser & { favoriteCount: number }
export type ProfileApi = {
  get(signal?: AbortSignal, expectedAccount?: string): Promise<Profile>
  update(name: string, signal?: AbortSignal, expectedAccount?: string): Promise<Profile>
}
