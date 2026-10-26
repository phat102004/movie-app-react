// Cùng cookie/CSRF policy cho Auth và Favorites; browser tự gửi Origin.
export function sessionRequestInit(
  method: 'GET' | 'POST' | 'DELETE',
  signal?: AbortSignal,
  body?: unknown,
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
      ...(method !== 'GET' ? { 'X-Cineverse-CSRF': '1' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}
