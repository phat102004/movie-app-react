import { HttpError } from './http.mjs'

const busy = () =>
  new HttpError(
    503,
    'UPSTREAM_BUSY',
    'Hệ thống tải dữ liệu phim đang bận. Vui lòng thử lại sau.',
  )
const aborted = () => new DOMException('Client disconnected', 'AbortError')

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} phải là số nguyên trong khoảng ${min}–${max}.`)
  return value
}

export function readTmdbProxyConfig(env = process.env) {
  const read = (name, fallback, min, max) => {
    if (env[name] === undefined) return fallback
    if (!/^(0|[1-9]\d*)$/.test(env[name]))
      throw new Error(`${name} phải là số nguyên hợp lệ.`)
    return integer(Number(env[name]), name, min, max)
  }
  return {
    maxConcurrent: read('TMDB_MAX_CONCURRENT', 6, 1, 16),
    maxQueue: read('TMDB_MAX_QUEUE', 32, 0, 128),
  }
}

// One scheduler per app server, shared by every allowlisted TMDB endpoint.
// Work includes reading/validating the body, not merely waiting for headers.
export function createUpstreamScheduler({
  maxConcurrent = 6,
  maxQueue = 32,
  maxWaiters = 256,
  timeoutMs = 8000,
  queueTimeoutMs = 2000,
} = {}) {
  integer(maxConcurrent, 'maxConcurrent', 1, 16)
  integer(maxQueue, 'maxQueue', 0, 128)
  integer(maxWaiters, 'maxWaiters', 1, 1024)
  integer(timeoutMs, 'timeoutMs', 1, 30_000)
  integer(queueTimeoutMs, 'queueTimeoutMs', 1, 10_000)
  const inflight = new Map()
  const queue = []
  let active = 0
  let waiterCount = 0

  function removeKey(job) {
    // A cancelled old task must never delete a newer job with the same key.
    if (inflight.get(job.key) === job) inflight.delete(job.key)
  }

  function settle(job, error, data) {
    if (job.done) return
    job.done = true
    clearTimeout(job.timer)
    removeKey(job)
    const index = queue.indexOf(job)
    if (index !== -1) queue.splice(index, 1)
    for (const waiter of job.waiters) waiter.finish(error, data)
    job.waiters.clear()
  }

  function cancel(job, error) {
    settle(job, error)
    job.controller.abort()
  }

  function start(job) {
    active++
    clearTimeout(job.timer)
    job.timer = setTimeout(() => {
      cancel(job, new HttpError(
        504,
        'UPSTREAM_TIMEOUT',
        'TMDB phản hồi quá lâu. Vui lòng thử lại.',
      ))
    }, timeoutMs)
    job.timer.unref()
    // Both resolution paths are observed, including late rejection after abort.
    // Keep the physical slot until work settles: a transport ignoring abort must
    // not allow unbounded simultaneous fetches by repeatedly timing out.
    const run = async () => {
      try {
        if (!job.controller.signal.aborted)
          settle(job, null, await job.work(job.controller.signal))
      } catch (error) {
        settle(job, error || new Error('Upstream task failed'))
      } finally {
        clearTimeout(job.timer)
        active--
        while (active < maxConcurrent && queue.length) start(queue.shift())
      }
    }
    void run()
  }

  function run(key, work, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(aborted())
    let job = inflight.get(key)
    if (
      waiterCount >= maxWaiters ||
      (!job && active >= maxConcurrent && queue.length >= maxQueue)
    )
      return Promise.reject(busy())

    const fresh = !job
    if (!job) {
      job = {
        key,
        work,
        controller: new AbortController(),
        waiters: new Set(),
        done: false,
        timer: undefined,
      }
      inflight.set(key, job)
    }
    const result = new Promise((resolve, reject) => {
      const waiter = {
        finish(error, data) {
          signal?.removeEventListener('abort', onAbort)
          waiterCount--
          if (error) reject(error)
          else resolve(data)
        },
      }
      const onAbort = () => {
        if (!job.waiters.delete(waiter)) return
        waiter.finish(aborted())
        if (!job.waiters.size) cancel(job, aborted())
      }
      job.waiters.add(waiter)
      waiterCount++
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    if (fresh) {
      if (active < maxConcurrent) start(job)
      else {
        queue.push(job)
        job.timer = setTimeout(() => {
          cancel(job, new HttpError(
            503,
            'UPSTREAM_QUEUE_TIMEOUT',
            'Hệ thống tải dữ liệu phim đang bận. Vui lòng thử lại sau.',
          ))
        }, queueTimeoutMs)
        job.timer.unref()
      }
    }
    return result
  }

  return {
    run,
    // Read-only diagnostics for tests; no public endpoint or request keys.
    getStats: () => ({
      active,
      queued: queue.length,
      inflight: inflight.size,
      waiters: waiterCount,
    }),
  }
}
