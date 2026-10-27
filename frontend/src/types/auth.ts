export type AuthUser = {
  id: string
  name: string
  email: string
  createdAt: string
}

export type AuthStatus = 'loading' | 'authenticated' | 'guest' | 'error'
export type LoginInput = { email: string; password: string }
export type RegisterInput = LoginInput & { name: string }
export type AuthField = 'name' | 'email' | 'password' | 'confirmPassword'
export type AuthFieldErrors = Partial<Record<AuthField, string>>

export type AuthSessionApi = {
  me(signal?: AbortSignal): Promise<AuthUser | null>
  login(input: LoginInput, signal?: AbortSignal): Promise<AuthUser>
  logout(signal?: AbortSignal, expectedAccount?: string): Promise<void>
}
