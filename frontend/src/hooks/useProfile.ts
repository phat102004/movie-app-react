import { useEffect, useRef, useState } from 'react'
import type { Profile, ProfileApi } from '../types/profile'
import {
  asProfileError,
  profileService,
  ProfileApiError,
} from '../services/profile'
import { useAuth } from './useAuth'
import { isSessionFailure } from '../services/sessionHttp'

export function useProfile(
  userId: string,
  service: ProfileApi = profileService,
) {
  const { refreshUser, sessionEpoch, isSessionCurrent, sessionChanged } = useAuth()
  const [state, setState] = useState<{
    id: string
    revision: number
    epoch: number
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
    state?.id === userId && state.revision === revision &&
    state.epoch === sessionEpoch ? state : null
  function verifyOwner(profile: Profile) {
    if (profile.id !== userId)
      throw new ProfileApiError(
        'Phiên tài khoản đã thay đổi. Đang kiểm tra lại phiên đăng nhập.',
        null,
        'PROFILE_OWNER_MISMATCH',
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
      busy.current = false
      setIsSaving(false)
      setSaveError(null)
      setSaved(false)
      try {
        const profile = await service.get(pending.signal, userId)
        if (profile.id !== userId)
          throw new ProfileApiError(
            'Phiên tài khoản đã thay đổi. Đang kiểm tra lại phiên đăng nhập.',
            null,
            'PROFILE_OWNER_MISMATCH',
          )
        if (
          alive.current && current === generation.current &&
          isSessionCurrent(sessionEpoch)
        )
          setState({ id: userId, revision, epoch: sessionEpoch, profile, error: null })
      } catch (cause) {
        if (
          alive.current &&
          current === generation.current &&
          !pending.signal.aborted
        ) {
          const error = asProfileError(cause)
          setState({ id: userId, revision, epoch: sessionEpoch, profile: null, error })
          if (isSessionFailure(error)) sessionChanged()
          else if (error.code === 'PROFILE_OWNER_MISMATCH') void refreshUser()
        }
      }
    }
    void load()
    return () => {
      alive.current = false
      pending.abort()
      mutation.current?.abort()
    }
  }, [userId, revision, service, sessionEpoch, isSessionCurrent, sessionChanged, refreshUser])

  async function updateName(name: string) {
    if (busy.current || !currentState?.profile || !isSessionCurrent(sessionEpoch)) return false
    busy.current = true
    const current = generation.current
    const pending = new AbortController()
    mutation.current = pending
    setIsSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const profile = verifyOwner(await service.update(name, pending.signal, userId))
      if (
        !alive.current ||
        current !== generation.current ||
        pending.signal.aborted ||
        !isSessionCurrent(sessionEpoch)
      )
        return false
      setState({ id: userId, revision, epoch: sessionEpoch, profile, error: null })
      // Header vẫn dùng AuthProvider; chỉ kiểm tra Me sau PATCH đã được API xác nhận.
      await refreshUser()
      if (
        !alive.current ||
        current !== generation.current ||
        pending.signal.aborted ||
        !isSessionCurrent(sessionEpoch)
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
        if (isSessionFailure(error)) {
          setState({ id: userId, revision, epoch: sessionEpoch, profile: null, error })
          sessionChanged()
        } else if (error.code === 'PROFILE_OWNER_MISMATCH') void refreshUser()
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
