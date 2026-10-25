import { DatabaseConfigError } from '../database/config.mjs'
import { HttpError } from '../http.mjs'

export function publicAuthError(error) {
  if (error instanceof HttpError) return error
  const kind = error?.meta?.driverAdapterError?.cause?.kind
  const unavailable =
    error instanceof DatabaseConfigError ||
    /^P10\d\d$/.test(error?.code ?? '') ||
    [
      'P2021',
      'P2022',
      'P2024',
      'P2028',
      'P2037',
      'ECONNREFUSED',
      'ETIMEDOUT',
    ].includes(error?.code) ||
    [
      'DatabaseNotReachable',
      'DatabaseDoesNotExist',
      'AuthenticationFailed',
      'SocketTimeout',
      'DatabaseAccessDenied',
    ].includes(kind)
  return unavailable
    ? new HttpError(
        503,
        'AUTH_UNAVAILABLE',
        'Chức năng tài khoản tạm thời chưa sẵn sàng. Vui lòng thử lại sau.',
      )
    : new HttpError(
        500,
        'INTERNAL_ERROR',
        'Không thể xử lý yêu cầu. Vui lòng thử lại sau.',
      )
}
