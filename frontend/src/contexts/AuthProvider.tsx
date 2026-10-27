import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { connectAuthSync } from '../services/authSync'
import { isSessionFailure } from '../services/sessionHttp'
import { AuthContext } from './auth-context'
import { authService, asAuthError, AuthApiError } from '../services/auth'
import {
  passwordChangeService,
  asPasswordChangeError,
  PasswordChangeApiError,
} from '../services/passwordChange'
import type {
  PasswordChangeInput,
  PasswordChangeApi,
} from '../types/passwordChange'
import type {
  AuthSessionApi,
  AuthStatus,
  AuthUser,
  LoginInput,
} from '../types/auth'

type SessionState = {
  user: AuthUser | null
  status: AuthStatus
  error: AuthApiError | null
}
type AuthMutation =
  | { kind: 'login'; input: LoginInput }
  | { kind: 'logout'; expectedAccount?: string; epoch: number }
  | { kind: 'password-change'; input: PasswordChangeInput; expectedAccount?: string; epoch: number }

export function AuthProvider({
  children,
  service = authService,
  passwordService = passwordChangeService,
}: {
  children: ReactNode
  service?: AuthSessionApi
  passwordService?: PasswordChangeApi
}) {
  const [state, setState] = useState<SessionState>({
    user: null,
    status: 'loading',
    error: null,
  })
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const identityEpoch = useRef(0)
  const uncertainRef = useRef(false)
  const stateRef = useRef(state)
  const sync = useRef<ReturnType<typeof connectAuthSync> | null>(null)
  const queuedRead = useRef(false)
  const rejectedAccount = useRef<string | null>(null)
  const reading = useRef<{
    controller: AbortController
    promise: Promise<void>
  } | null>(null)
  const mounted = useRef(false)
  const version = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const mutation = useRef(false)
  const advanceEpoch = useCallback(() => {
    setSessionEpoch(++identityEpoch.current)
  }, [])
  const applyState = useCallback((next: SessionState) => {
    stateRef.current = next
    setState(next)
  }, [])
  const isSessionCurrent = useCallback(
    (epoch: number) =>
      mounted.current && !uncertainRef.current && epoch === identityEpoch.current,
    [],
  )
  const dismissSessionNotice = useCallback(() => setSessionNotice(null), [])
  const acknowledgePasswordChange = useCallback(
    () => setPasswordChanged(false),
    [],
  )

  const readSession = useCallback(
    async (pending: AbortController, current: number) => {
      try {
        const user = await service.me(pending.signal)
        if (
          mounted.current &&
          current === version.current &&
          !pending.signal.aborted
        ) {
          const previous = stateRef.current
          if (previous.status !== 'loading' && previous.user?.id !== user?.id) {
            rejectedAccount.current = null
            advanceEpoch()
            setSessionNotice(
              'Phiên tài khoản đã thay đổi. Vui lòng kiểm tra thông tin và thử lại thao tác.',
            )
          }
          uncertainRef.current = false
          setUncertain(false)
          applyState({
            user,
            status: user ? 'authenticated' : 'guest',
            error: null,
          })
        }
      } catch (error) {
        if (
          mounted.current &&
          current === version.current &&
          !pending.signal.aborted
        )
          applyState({
            user: stateRef.current.user,
            status: stateRef.current.user ? 'authenticated' : 'error',
            error: asAuthError(error),
          })
      } finally {
        if (mounted.current && current === version.current)
          setIsRefreshing(false)
      }
    },
    [service, applyState, advanceEpoch],
  )

  const cancelPending = useCallback(() => {
    ++version.current
    controller.current?.abort()
  }, [])

  const refreshUser = useCallback(async (automatic = false) => {
    if (!automatic) rejectedAccount.current = null
    if (mutation.current) {
      queuedRead.current = true
      return
    }
    if (reading.current && !reading.current.controller.signal.aborted)
      return reading.current.promise
    cancelPending()
    const current = version.current
    const pending = new AbortController()
    controller.current = pending
    setIsRefreshing(true)
    const promise = readSession(pending, current).finally(() => {
      if (reading.current?.controller === pending) reading.current = null
    })
    reading.current = { controller: pending, promise }
    await promise
  }, [cancelPending, readSession])

  const invalidateSession = useCallback((notify: boolean) => {
    // Invalidate synchronously: late callbacks cannot commit before the next render/effect.
    uncertainRef.current = true
    setUncertain(true)
    setIsRefreshing(true)
    advanceEpoch()
    ++version.current
    if (!mutation.current) controller.current?.abort()
    if (notify)
      setSessionNotice(
        'Phiên tài khoản đã thay đổi. Thao tác chưa được xác nhận; vui lòng kiểm tra lại và thử lại.',
      )
  }, [advanceEpoch])
  const sessionChanged = useCallback(() => {
    const account = stateRef.current.user?.id ?? null
    const repeated = account !== null && rejectedAccount.current === account
    rejectedAccount.current = account
    invalidateSession(true)
    if (repeated) {
      // A broken endpoint must not cause Me → reload private data → 403 → Me forever.
      applyState({
        ...stateRef.current,
        error: new AuthApiError(
          'Chưa thể xác minh tài khoản cho thao tác này. Vui lòng kiểm tra lại phiên.',
          403,
          'SESSION_CHANGED',
        ),
      })
      setIsRefreshing(false)
    } else void refreshUser(true)
  }, [invalidateSession, refreshUser, applyState])

  useEffect(() => {
    mounted.current = true
    void refreshUser()
    return () => {
      mounted.current = false
      cancelPending()
    }
  }, [refreshUser, cancelPending])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (notify = true) => {
      invalidateSession(notify)
      if (timer !== undefined) clearTimeout(timer)
      // Coalesce focus/visibility and duplicate channel/storage signals; never poll.
      timer = setTimeout(() => {
        timer = undefined
        void refreshUser(true)
      }, 60)
    }
    const connection = connectAuthSync(() => schedule(true))
    sync.current = connection
    const focus = () => schedule(false)
    const visible = () => {
      if (document.visibilityState === 'visible') schedule(false)
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      connection.close()
      sync.current = null
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [invalidateSession, refreshUser])

  const runMutation = useCallback(
    async (action: AuthMutation) => {
      const OperationError = action.kind === 'password-change'
        ? PasswordChangeApiError : AuthApiError
      if (action.kind !== 'login' && (
        !isSessionCurrent(action.epoch) ||
        action.expectedAccount !== stateRef.current.user?.id
      ))
        throw new OperationError(
          'Đang xác minh lại phiên đăng nhập. Vui lòng thử lại.', 403, 'SESSION_CHANGED',
        )
      if (mutation.current)
        throw new OperationError(
          'Đang xử lý yêu cầu tài khoản. Vui lòng đợi.',
          null,
          'AUTH_BUSY',
        )
      mutation.current = true
      const current = ++version.current
      // Capture the UI caller's account, never silently retarget an old callback
      // using the latest user from stateRef when another account has just logged in.
      const expectedAccount = action.kind === 'login' ? undefined : action.expectedAccount
      controller.current?.abort()
      const pending = new AbortController()
      controller.current = pending
      setIsRefreshing(false)
      if (action.kind === 'logout') setIsSigningOut(true)
      if (action.kind === 'password-change') setIsChangingPassword(true)
      else setPasswordChanged(false)
      try {
        const user =
          action.kind === 'login'
            ? await service.login(action.input, pending.signal)
            : action.kind === 'logout'
              ? (await service.logout(pending.signal, expectedAccount), null)
              : (await passwordService.change(
                  action.input, pending.signal, expectedAccount,
                ),
                null)
        sync.current?.notify()
        if (mounted.current && current === version.current) {
          uncertainRef.current = false
          setUncertain(false)
          advanceEpoch()
          rejectedAccount.current = null
          applyState({
            user,
            status: user ? 'authenticated' : 'guest',
            error: null,
          })
          if (action.kind === 'password-change') setPasswordChanged(true)
        } else {
          queuedRead.current = true
          throw new OperationError(
            'Phiên tài khoản đã thay đổi. Vui lòng thử lại.', 403, 'SESSION_CHANGED',
          )
        }
        return user
      } catch (error) {
        // Nếu mutation thay thế lần /me ban đầu rồi thất bại, trạng thái vẫn chưa biết.
        if (mounted.current && current === version.current) {
          const failure = action.kind === 'password-change'
            ? asPasswordChangeError(error) : asAuthError(error)
          if (action.kind !== 'login' && isSessionFailure(failure)) {
            sessionChanged()
          } else if (stateRef.current.status === 'loading')
            applyState({ ...stateRef.current, status: 'error', error: asAuthError(error) })
        }
        throw action.kind === 'password-change'
          ? asPasswordChangeError(error)
          : asAuthError(error)
      } finally {
        mutation.current = false
        if (mounted.current) {
          setIsSigningOut(false)
          setIsChangingPassword(false)
          if (queuedRead.current) {
            queuedRead.current = false
            void refreshUser(true)
          }
        }
      }
    },
    [service, passwordService, advanceEpoch, applyState, sessionChanged, refreshUser, isSessionCurrent],
  )

  const login = useCallback(
    async (input: LoginInput) => (await runMutation({ kind: 'login', input }))!,
    [runMutation],
  )
  const logout = useCallback(async () => {
    await runMutation({ kind: 'logout', expectedAccount: state.user?.id, epoch: sessionEpoch })
  }, [runMutation, state.user?.id, sessionEpoch])
  const changePassword = useCallback(
    async (input: PasswordChangeInput) => {
      await runMutation({
        kind: 'password-change', input,
        expectedAccount: state.user?.id, epoch: sessionEpoch,
      })
    },
    [runMutation, state.user?.id, sessionEpoch],
  )

  return (
    <AuthContext.Provider
      value={{
        ...state,
        user: uncertain ? null : state.user,
        status: uncertain ? (isRefreshing ? 'loading' : 'error') : state.status,
        sessionEpoch,
        sessionNotice,
        sessionChanged,
        isSessionCurrent,
        dismissSessionNotice,
        isRefreshing,
        isSigningOut,
        isChangingPassword,
        passwordChanged,
        acknowledgePasswordChange,
        changePassword,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
