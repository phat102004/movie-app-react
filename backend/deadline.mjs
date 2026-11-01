export async function withDeadline(work, ms, onTimeout = () => {}) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { onTimeout() } catch { /* Deadline must still reject safely. */ }
          reject(new Error('Operation deadline exceeded'))
        }, ms)
      }),
    ])
  } finally { clearTimeout(timer) }
}
