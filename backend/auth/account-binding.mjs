import { HttpError } from '../http.mjs'

// A precondition only: user MUST already come from the authenticated cookie.
// Never use the asserted account as a query owner or an authentication credential.
export function assertAccountBinding(request, user) {
  if (request.headers['x-cineverse-account'] !== user.id)
    throw new HttpError(
      403,
      'SESSION_CHANGED',
      'Phiên tài khoản đã thay đổi. Vui lòng kiểm tra lại phiên và thử lại.',
    )
}
