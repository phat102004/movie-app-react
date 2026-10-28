// Fixed window: route supplies the normalized IP from the shared trusted-proxy policy.
// Map có giới hạn và không có timer nền; chỉ phù hợp một process backend local.
export function createRegisterLimiter({
  limit = 5,
  windowMs = 15 * 60_000,
  maxEntries = 10_000,
  now = Date.now,
} = {}) {
  const clients = new Map()
  return function take(ip) {
    const time = now()
    let entry = clients.get(ip)
    if (entry && entry.resetAt <= time) {
      clients.delete(ip)
      entry = undefined
    }
    if (!entry) {
      if (clients.size >= maxEntries) {
        for (const [key, value] of clients)
          if (value.resetAt <= time) clients.delete(key)
        if (clients.size >= maxEntries)
          return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) }
      }
      entry = { count: 0, resetAt: time + windowMs }
      clients.set(ip, entry)
    }
    if (entry.count >= limit)
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)),
      }
    entry.count++
    return { allowed: true }
  }
}
