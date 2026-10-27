// Cùng cookie/CSRF policy cho Auth, Favorites và Profile; browser tự gửi Origin.
export function sessionRequestInit(
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  signal?: AbortSignal,
  body?: unknown,
  expectedAccount?: string,
): RequestInit {
  return {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
    headers: {
      Accept: 'application/json',
      ...(expectedAccount ? { 'X-Cineverse-Account': expectedAccount } : {}),
      ...(method !== 'GET' ? { 'X-Cineverse-CSRF': '1' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}

// Ordinary 403 (CSRF/Origin) is not an identity change and must not cause retry loops.
export function isSessionFailure(error: { status: number | null; code: string }) {
  return error.status === 401 || error.code === 'SESSION_CHANGED'
}
