import { createHmac, randomBytes } from 'node:crypto'
import { createRegisterLimiter } from './rate-limit.mjs'

export function createLoginLimiter({
  ip = createRegisterLimiter({ limit: 20 }),
  account = createRegisterLimiter({ limit: 10 }),
} = {}) {
  const key = randomBytes(32)
  return {
    takeIp: (address) => ip(address),
    takeAccount: (email) =>
      account(createHmac('sha256', key).update(email).digest('hex')),
  }
}
