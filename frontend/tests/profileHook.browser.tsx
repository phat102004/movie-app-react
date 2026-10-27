// Dev-only: deliberately ignore cancellation in injected API to exercise mounted/owner guards.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../src/contexts/AuthProvider'
import { useAuth } from '../src/hooks/useAuth'
import { useProfile } from '../src/hooks/useProfile'
import { profileService } from '../src/services/profile'
import type { ProfileApi } from '../src/types/profile'

const noSignalService: ProfileApi = {
  get: () => profileService.get(),
  update: (name) => profileService.update(name),
}
export function ProfileReader({ id }: { id: string }) {
  const profile = useProfile(id, noSignalService)
  return (
    <>
      <output id="profile-name">{profile.profile?.name ?? ''}</output>
      <output id="profile-id">{profile.profile?.id ?? ''}</output>
      <output id="profile-state">
        {profile.isLoading ? 'loading' : (profile.error?.code ?? 'ready')}
      </output>
      <output id="saving">{String(profile.isSaving)}</output>
      <output id="saved">{String(profile.saved)}</output>
      <button
        onClick={() => {
          void profile.updateName('Late profile name')
          void profile.updateName('Late profile name')
        }}
      >
        Save twice
      </button>
      <button onClick={profile.retry}>Retry profile</button>
    </>
  )
}
export function Harness() {
  const auth = useAuth()
  return (
    <>
      <output id="owner">{auth.user?.name ?? 'guest'}</output>
      <button
        onClick={() =>
          void auth.login({
            email: 'a@fixture.test',
            password: 'Synthetic profile UI password 123!',
          })
        }
      >
        Login A
      </button>
      <button
        onClick={() =>
          void auth.login({
            email: 'b@fixture.test',
            password: 'Synthetic profile UI password 123!',
          })
        }
      >
        Login B
      </button>
      <button onClick={() => void auth.logout()}>Logout</button>
      {auth.user && !auth.isSigningOut && (
        <ProfileReader key={auth.user.id} id={auth.user.id} />
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Harness />
    </AuthProvider>
  </StrictMode>,
)
