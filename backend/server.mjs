import { createServer } from 'node:http'
import { createRegisterHandler } from './auth/register-route.mjs'
import { createProxyHandler } from './proxy.mjs'
import { HttpError, sendHttpError } from './http.mjs'
import { readAuthConfig } from './auth/config.mjs'
import { assertAuthRequest } from './auth/security.mjs'
import { createSessionService } from './auth/session-service.mjs'
import { createLoginService } from './auth/login-service.mjs'
import { createSessionHandlers } from './auth/session-routes.mjs'
import { createResetEmailDelivery } from './auth/reset-email.mjs'
import { createPasswordResetService } from './auth/password-reset-service.mjs'
import { createPasswordResetHandlers } from './auth/password-reset-routes.mjs'
import { createFavoriteService } from './favorites/favorite-service.mjs'
import { createFavoriteHandler } from './favorites/favorite-routes.mjs'
import { createProfileService } from './profile/profile-service.mjs'
import { createProfileHandler } from './profile/profile-routes.mjs'
import { createChangePasswordService } from './profile/change-password-service.mjs'
import { createChangePasswordHandler } from './profile/change-password-routes.mjs'

export function createAppServer({
  tmdb = {},
  registration = {},
  auth = {},
  passwordReset = {},
  favorites = {},
  profile = {},
  passwordChange = {},
} = {}) {
  const config = auth.config ?? readAuthConfig()
  const sessions =
    auth.sessions ??
    createSessionService({ config, getClient: auth.getClient, now: auth.now })
  const login =
    auth.login ??
    createLoginService({
      sessions,
      getClient: auth.getClient,
      verifyPassword: auth.verifyPassword,
      dummyHash: auth.dummyHash,
    })
  const sessionHandlers = createSessionHandlers({
    ...auth,
    config,
    sessions,
    login,
  })
  const handleProxy = createProxyHandler(tmdb)
  const handleRegister = createRegisterHandler(registration)
  const handlePasswordChange = createChangePasswordHandler({
    ...passwordChange,
    config,
    sessions,
    service:
      passwordChange.service ??
      createChangePasswordService({
        ...passwordChange,
        getClient: passwordChange.getClient ?? auth.getClient,
        now: auth.now,
      }),
  })
  const handleProfile = createProfileHandler({
    ...profile,
    config,
    sessions,
    service:
      profile.service ??
      createProfileService({
        getClient: profile.getClient ?? auth.getClient,
        now: auth.now,
      }),
  })
  const handleFavorites = createFavoriteHandler({
    ...favorites,
    config,
    sessions,
    service:
      favorites.service ??
      createFavoriteService({
        getClient: favorites.getClient ?? auth.getClient,
      }),
  })
  const resetHandlers = createPasswordResetHandlers({
    ...passwordReset,
    service:
      passwordReset.service ??
      createPasswordResetService({
        ...passwordReset,
        getClient: passwordReset.getClient ?? auth.getClient,
        delivery:
          passwordReset.delivery ?? createResetEmailDelivery({ config }),
      }),
  })
  const routes = new Map([
    ['/api/auth/register', ['POST', handleRegister]],
    ['/api/auth/login', ['POST', sessionHandlers.login]],
    ['/api/auth/me', ['GET', sessionHandlers.me]],
    ['/api/auth/logout', ['POST', sessionHandlers.logout]],
    ['/api/auth/forgot-password', ['POST', resetHandlers.forgot]],
    ['/api/auth/reset-password', ['POST', resetHandlers.reset]],
  ])
  return createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000 },
    async (request, response) => {
      response.setHeader('Referrer-Policy', 'no-referrer')
      try {
        let url
        try {
          url = new URL(request.url ?? '/', 'http://localhost')
        } catch {
          throw new HttpError(400, 'BAD_REQUEST', 'Đường dẫn không hợp lệ.')
        }
        if (url.pathname === '/api/profile/change-password') {
          await handlePasswordChange(request, response, url)
          return
        }
        if (
          url.pathname === '/api/profile' ||
          url.pathname.startsWith('/api/profile/')
        ) {
          await handleProfile(request, response, url)
          return
        }
        if (
          url.pathname === '/api/favorites' ||
          url.pathname.startsWith('/api/favorites/')
        ) {
          await handleFavorites(request, response, url)
          return
        }
        const route = !url.search && routes.get(url.pathname)
        if (route) {
          if (request.method !== route[0]) {
            response.setHeader('Allow', route[0])
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              `Chỉ hỗ trợ ${route[0]}.`,
            )
          }
          assertAuthRequest(request, config)
          await route[1](request, response)
        } else await handleProxy(request, response)
      } catch (error) {
        request.resume()
        sendHttpError(response, error)
      }
    },
  )
}
