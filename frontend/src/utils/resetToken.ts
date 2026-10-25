// Chỉ trong RAM. Fragment không được gửi lên HTTP server hoặc trong Referer.
let resetToken: string | null = null

export function captureResetToken(): string | null {
  if (window.location.pathname !== '/reset-password') return null
  const { hash, search, pathname } = window.location
  if (hash || search) {
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(hash)
    resetToken = !search && match ? match[1] : null
    // Giữ state nội bộ của React Router; không ghi token vào history state.
    window.history.replaceState(window.history.state, '', pathname)
  }
  return resetToken
}

export function clearResetToken() {
  resetToken = null
}
