// Covers both headers and body. Detach timer/listeners even when transport ignores
// abort; Promise.race still observes any late resolution/rejection.
export async function withRequestDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal,
  timeoutMs = 12_000,
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) forwardAbort()
  else caller?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError'))
  }, timeoutMs)
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason)
    if (controller.signal.aborted) onAbort()
    else controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([
      aborted,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return work(controller.signal)
      }),
    ])
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', forwardAbort)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
