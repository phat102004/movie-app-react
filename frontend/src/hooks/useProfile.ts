import { useEffect, useRef, useState } from 'react'
import type { Profile, ProfileApi } from '../types/profile'
import {
  asProfileError,
  profileService,
  ProfileApiError,
} from '../services/profile'
import { useAuth } from './useAuth'

export function useProfile(
  userId: string,
  service: ProfileApi = profileService,
) {
  const { refreshUser } = useAuth()
  const [state, setState] = useState<{
    id: string
    revision: number
    profile: Profile | null
    error: ProfileApiError | null
  } | null>(null)
  const [revision, setRevision] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<ProfileApiError | null>(null)
  const [saved, setSaved] = useState(false)
  const alive = useRef(false)
  const generation = useRef(0)
  const busy = useRef(false)
  const mutation = useRef<AbortController | null>(null)

  const currentState =
    state?.id === userId && state.revision === revision ? state : null
  function verifyOwner(profile: Profile) {
    if (profile.id !== userId)
      throw new ProfileApiError(
        'Phiên tài khoản đã thay đổi. Đang kiểm tra lại phiên đăng nhập.',
        null,
        'SESSION_CHANGED',
      )
    return profile
  }

  useEffect(() => {
    alive.current = true
    const current = ++generation.current
    const pending = new AbortController()
    async function load() {
      await Promise.resolve()
      if (pending.signal.aborted) return
      try {
        const profile = await service.get(pending.signal)
        if (profile.id !== userId)
          throw new ProfileApiError(
            'Phiên tài khoản đã thay đổi. Đang kiểm tra lại phiên đăng nhập.',
            null,
            'SESSION_CHANGED',
          )
        if (alive.current && current === generation.current)
          setState({ id: userId, revision, profile, error: null })
      } catch (cause) {
        if (
          alive.current &&
          current === generation.current &&
          !pending.signal.aborted
        ) {
          const error = asProfileError(cause)
          setState({ id: userId, revision, profile: null, error })
          if (error.status === 401 || error.code === 'SESSION_CHANGED')
            void refreshUser()
        }
      }
    }
    void load()
    return () => {
      alive.current = false
      pending.abort()
      mutation.current?.abort()
    }
  }, [userId, revision, service, refreshUser])

  async function updateName(name: string) {
    if (busy.current || !currentState?.profile) return false
    busy.current = true
    const current = generation.current
    const pending = new AbortController()
    mutation.current = pending
    setIsSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const profile = verifyOwner(await service.update(name, pending.signal))
      if (
        !alive.current ||
        current !== generation.current ||
        pending.signal.aborted
      )
        return false
      setState({ id: userId, revision, profile, error: null })
      // Header vẫn dùng AuthProvider; chỉ kiểm tra Me sau PATCH đã được API xác nhận.
      await refreshUser()
      if (
        !alive.current ||
        current !== generation.current ||
        pending.signal.aborted
      )
        return false
      setSaved(true)
      return true
    } catch (cause) {
      if (
        alive.current &&
        current === generation.current &&
        !pending.signal.aborted
      ) {
        const error = asProfileError(cause)
        setSaveError(error)
        if (error.status === 401 || error.code === 'SESSION_CHANGED') {
          setState({ id: userId, revision, profile: null, error })
          void refreshUser()
        }
      }
      return false
    } finally {
      if (alive.current && current === generation.current) {
        busy.current = false
        setIsSaving(false)
      }
    }
  }

  return {
    profile: currentState?.profile ?? null,
    error: currentState?.error ?? null,
    isLoading: currentState === null,
    isSaving,
    saveError,
    saved,
    updateName,
    clearFeedback: () => {
      setSaveError(null)
      setSaved(false)
    },
    retry: () => {
      if (!busy.current) {
        setSaved(false)
        setSaveError(null)
        setRevision((value) => value + 1)
      }
    },
  }
}
