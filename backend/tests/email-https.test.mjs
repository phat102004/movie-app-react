import assert from 'node:assert/strict'
import test from 'node:test'
import { createResetEmailDelivery, readResetEmailConfig } from '../auth/reset-email.mjs'
import { createResendTransport } from '../auth/resend-transport.mjs'
import { createPasswordResetService, forgotMessage } from '../auth/password-reset-service.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { memoryDatabase } from './helpers/auth-fixture.mjs'

const env = () => ({ NODE_ENV: 'production', AUTH_ALLOWED_ORIGINS: 'https://cinema.fixture.test',
  PUBLIC_APP_ORIGIN: 'https://cinema.fixture.test', PASSWORD_RESET_EMAIL_MODE: 'resend',
  SMTP_FROM: 'cinema@fixture.test', RESEND_API_KEY: 're_synthetic_https_email_fixture_only' })
const receipt = () => Response.json({ id: '00000000-0000-4000-8000-000000000001' })

test('HTTPS email config requires approved origin/sender/key; local SMTP and disabled behavior stay intact', () => {
  assert.equal(readResetEmailConfig(env(), readAuthConfig(env())).transport, 'resend')
  for (const patch of [{ RESEND_API_KEY: '' }, { RESEND_API_KEY: '<PLACEHOLDER>' },
    { PUBLIC_APP_ORIGIN: 'https://attacker.fixture.test' }, { SMTP_FROM: 'bad\r\nheader' }])
    assert.throws(() => readResetEmailConfig({ ...env(), ...patch }, readAuthConfig(env())))
  assert.equal(readResetEmailConfig({ PASSWORD_RESET_EMAIL_MODE: 'disabled' }, readAuthConfig({})), null)
})

test('known and unknown recovery use the same HTTPS transport and public response; token remains server/email-only with unchanged TTL', async () => {
  const sent = []
  const config = env()
  const delivery = createResetEmailDelivery({ config: readAuthConfig(config), env: config,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails')
      assert.equal(init.redirect, 'error')
      assert.equal(init.headers.Authorization, `Bearer ${config.RESEND_API_KEY}`)
      sent.push(JSON.parse(init.body))
      return receipt()
    } })
  const client = memoryDatabase([{ id: '00000000-0000-4000-8000-000000000001', email: 'a@fixture.test' }])
  const service = createPasswordResetService({ delivery, getClient: async () => client, minimumDurationMs: 0 })
  const known = await service.forgot({ email: 'a@fixture.test' })
  const unknown = await service.forgot({ email: 'missing@fixture.test' })
  assert.deepEqual(known, { message: forgotMessage })
  assert.deepEqual(known, unknown)
  assert.equal(sent.length, 2)
  assert.match(sent[0].text, /https:\/\/cinema\.fixture\.test\/reset-password#token=/)
  assert.equal(sent[1].text.includes('#token='), false)
  const [row] = client.resetTokens.values()
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 20 * 60 * 1000)
  assert.equal(row.tokenHash.length, 64)
  assert.equal(JSON.stringify(known).includes('#token='), false)
})

test('provider auth/quota/network/redirect/malformed/oversized failures expose only EMAIL_UNAVAILABLE', async () => {
  const failing = [
    async () => Response.json({ message: 'synthetic-private-api-key' }, { status: 403 }),
    async () => Response.json({ message: 'synthetic-private-email' }, { status: 429 }),
    async () => { throw Error('synthetic-private-request-reset-token') },
    async () => new Response(null, { status: 302, headers: { Location: 'https://attacker.fixture.test' } }),
    async () => Response.json({ success: true }),
    async () => new Response('bad json'),
    async () => new Response('x'.repeat(9000)),
  ]
  for (const fetchImpl of failing) {
    const delivery = createResetEmailDelivery({ config: readAuthConfig(env()), env: env(), fetchImpl })
    await assert.rejects(delivery.send({ email: 'a@fixture.test', resetUrl: null }), error =>
      error.status === 503 && error.code === 'EMAIL_UNAVAILABLE' && !error.message.includes('synthetic-private'))
  }
})

test('HTTPS email deadline aborts request, rejects a transport ignoring AbortSignal, and handles late rejection', async () => {
  let signal, reject
  const transport = createResendTransport(env().RESEND_API_KEY, { timeoutMs: 15,
    fetchImpl: async (_url, init) => {
      signal = init.signal
      return new Promise((_, r) => { reject = r })
    } })
  await assert.rejects(transport.sendMail({ to: 'a@fixture.test', text: 'fixture' }))
  assert.equal(signal.aborted, true)
  reject(new Error('synthetic-private-late-provider-error'))
  await new Promise(setImmediate)
})

test('failed HTTPS delivery removes token and cannot return success or disclose account existence', async () => {
  const delivery = createResetEmailDelivery({ config: readAuthConfig(env()), env: env(),
    fetchImpl: async () => Response.json({ message: 'synthetic-private' }, { status: 503 }) })
  const client = memoryDatabase([{ id: '00000000-0000-4000-8000-000000000001', email: 'a@fixture.test' }])
  const service = createPasswordResetService({ delivery, getClient: async () => client, minimumDurationMs: 0 })
  for (const email of ['a@fixture.test', 'missing@fixture.test']) {
    await assert.rejects(service.forgot({ email }), { status: 503, code: 'EMAIL_UNAVAILABLE' })
    assert.equal(client.resetTokens.size, 0)
  }
})
