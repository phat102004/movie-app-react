import { createContext } from 'react'
import type { AuthStatus, AuthUser, LoginInput } from '../types/auth'
import type { AuthApiError } from '../services/auth'
import type { PasswordChangeInput } from '../types/passwordChange'

export type AuthContextValue = {
  user: AuthUser | null
  status: AuthStatus
  error: AuthApiError | null
  isRefreshing: boolean
  isSigningOut: boolean
  isChangingPassword: boolean
  passwordChanged: boolean
  acknowledgePasswordChange(): void
  changePassword(input: PasswordChangeInput): Promise<void>
  login(input: LoginInput): Promise<AuthUser>
  logout(): Promise<void>
  refreshUser(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
