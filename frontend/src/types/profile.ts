import type { AuthUser } from './auth'

export type Profile = AuthUser & { favoriteCount: number }
export type ProfileApi = {
  get(signal?: AbortSignal): Promise<Profile>
  update(name: string, signal?: AbortSignal): Promise<Profile>
}
