import { HttpError } from '../http.mjs'
import { randomBytes } from 'node:crypto'

export function readHashOptions(env = process.env) {
  const read = (name, fallback, min, max) => {
    const raw = env[name]
    const value = raw === undefined || raw === '' ? fallback : Number(raw)
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new HttpError(
        503,
        'REGISTRATION_UNAVAILABLE',
        'Chức năng đăng ký tạm thời chưa sẵn sàng.',
      )
    }
    return value
  }
  return {
    memoryCost: read('ARGON2_MEMORY_KIB', 19456, 19456, 262144),
    timeCost: read('ARGON2_TIME_COST', 2, 2, 10),
    parallelism: read('ARGON2_PARALLELISM', 1, 1, 4),
  }
}

export async function hashRegistrationPassword(password) {
  const options = readHashOptions()
  // node-argon2 tự sinh random salt cho mỗi lần hash; không log hoặc trả hash.
  const { hash, argon2id } = await import('argon2')
  return hash(password, { ...options, type: argon2id, hashLength: 32 })
}

let dummyHashPromise
export function getDummyPasswordHash() {
  // Một hash ngẫu nhiên/process, không thuộc tài khoản thật; khởi tạo khi login.
  dummyHashPromise ??= hashRegistrationPassword(
    randomBytes(32).toString('base64url'),
  ).catch((error) => {
    dummyHashPromise = undefined
    throw error
  })
  return dummyHashPromise
}

export async function verifyLoginPassword(passwordHash, password) {
  const { verify } = await import('argon2')
  return verify(passwordHash, password)
}
