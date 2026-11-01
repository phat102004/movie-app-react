import { withDeadline } from '../deadline.mjs'

// Fixed HTTPS destination, no redirects/retries and no SDK or provider error logs.
export function createResendTransport(apiKey, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  return {
    async sendMail(message) {
      const controller = new AbortController()
      return withDeadline(async () => {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text }),
        })
        if (!response.ok || !response.body) {
          await response.body?.cancel()
          throw new Error('Email delivery unavailable')
        }
        const reader = response.body.getReader()
        const chunks = []
        let length = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.length
            if (length > 8192) { await reader.cancel(); throw new Error('Email receipt too large') }
            chunks.push(value)
          }
        } finally { reader.releaseLock() }
        const receipt = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (typeof receipt?.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(receipt.id))
          throw new Error('Invalid email receipt')
        return { accepted: [message.to], rejected: [] }
      }, timeoutMs, () => controller.abort())
    },
  }
}
