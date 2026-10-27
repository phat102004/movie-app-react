// Signals only. No user data, cookies, session IDs or credentials leave RAM.
const channelName = 'cineverse-auth-v1'
const storageKey = 'cineverse.auth-change'
type ChangeSignal = { type: 'session-change'; nonce: string }
const isSignal = (value: unknown): value is ChangeSignal =>
  !!value && typeof value === 'object' &&
  'type' in value && value.type === 'session-change' &&
  'nonce' in value && typeof value.nonce === 'string' && value.nonce.length <= 80

export function connectAuthSync(onChange: () => void) {
  let channel: BroadcastChannel | undefined
  let lastNonce = ''
  const receive = (value: unknown) => {
    if (!isSignal(value) || value.nonce === lastNonce) return
    lastNonce = value.nonce
    onChange()
  }
  try {
    channel = new BroadcastChannel(channelName)
    channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data)
  } catch { /* Storage + focus fallback below also work without BroadcastChannel. */ }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return
    try { receive(JSON.parse(event.newValue)) } catch { /* Ignore unrelated/invalid data. */ }
  }
  window.addEventListener('storage', onStorage)
  return {
    notify() {
      const signal: ChangeSignal = { type: 'session-change', nonce: crypto.randomUUID() }
      try { channel?.postMessage(signal) } catch { /* Still signal via storage. */ }
      try {
        // Also emit for recipients without BroadcastChannel. Leave no persistent entry.
        localStorage.setItem(storageKey, JSON.stringify(signal))
        localStorage.removeItem(storageKey)
      } catch { /* Storage can be disabled; focus + server precondition remain effective. */ }
    },
    close() {
      channel?.close()
      window.removeEventListener('storage', onStorage)
    },
  }
}

export function announceAuthChange() {
  const connection = connectAuthSync(() => {})
  connection.notify()
  connection.close()
}
