import assert from 'node:assert/strict'
import test from 'node:test'
import { createClientIpResolver } from '../client-ip.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { createAppServer } from '../server.mjs'
import { execFileSync } from 'node:child_process'

const request = (socket, forwarded, extra = {}) => ({
  socket: { remoteAddress: socket },
  headers: { 'x-forwarded-for': forwarded, ...extra },
})
const resolve = createClientIpResolver('127.0.0.1,10.0.0.0/24,2001:db8:ffff::/48')

test('Default policy ignores all forwarding headers and uses socket only', () => {
  const direct = createClientIpResolver()
  assert.equal(direct(request('203.0.113.2', '198.51.100.2', {
    forwarded: 'for=198.51.100.3', 'x-real-ip': '198.51.100.4',
  })), '203.0.113.2')
  assert.equal(direct(request('127.0.0.1', '198.51.100.2')), '127.0.0.1')
  assert.equal(resolve(request('203.0.113.2', '198.51.100.2')), '203.0.113.2')
})

test('Trusted immediate proxy, single hop and multiple trusted hops', () => {
  assert.equal(resolve(request('127.0.0.1', '198.51.100.2')), '198.51.100.2')
  assert.equal(resolve(request('127.0.0.1', '198.51.100.2, 10.0.0.7')), '198.51.100.2')
  assert.equal(resolve(request('2001:db8:ffff::5', '198.51.100.2, 10.0.0.7')), '198.51.100.2')
  assert.equal(resolve(request('127.0.0.1', '10.0.0.3, 10.0.0.7')), '10.0.0.3')
})

test('Stops at rightmost untrusted hop; ignores attacker-controlled left prefix', () => {
  assert.equal(resolve(request('127.0.0.1', '192.0.2.99, 198.51.100.2, 10.0.0.7')), '198.51.100.2')
  assert.equal(resolve(request('127.0.0.1', '192.0.2.99, 10.0.1.7')), '10.0.1.7')
  // CIDR boundary: 10.0.1.0 is not in 10.0.0.0/24.
  assert.equal(resolve(request('10.0.1.0', '198.51.100.2')), '10.0.1.0')
})

test('IPv6 spelling and mapped IPv6 share one normalized quota key', () => {
  const direct = createClientIpResolver()
  for (const address of ['2001:DB8::AB', '2001:0db8:0000:0:0:0:0:00ab'])
    assert.equal(direct(request(address)), '2001:db8:0:0:0:0:0:ab')
  for (const address of ['192.0.2.1', '::ffff:192.0.2.1', '0:0:0:0:0:FFFF:c000:201'])
    assert.equal(direct(request(address)), '192.0.2.1')
  assert.equal(direct(request('::192.0.2.1')), '0:0:0:0:0:0:c000:201')
  assert.equal(resolve(request('::ffff:127.0.0.1', '::FFFF:c633:6402')), '198.51.100.2')
  assert.equal(createClientIpResolver('::ffff:10.0.0.0/120')(
    request('10.0.0.9', '192.0.2.8')), '192.0.2.8')
})

test('IPv6 CIDRs and exact host entries have correct boundaries', () => {
  const subnet = createClientIpResolver('2001:db8::/64,192.0.2.5/32')
  assert.equal(subnet(request('2001:db8:0:0:ffff::1', '198.51.100.3')), '198.51.100.3')
  assert.equal(subnet(request('2001:db8:0:1::1', '198.51.100.3')), '2001:db8:0:1:0:0:0:1')
  assert.equal(subnet(request('192.0.2.5', '198.51.100.3')), '198.51.100.3')
  assert.equal(subnet(request('192.0.2.6', '198.51.100.3')), '192.0.2.6')
  assert.equal(createClientIpResolver('::1/128')(request('::1', '192.0.2.3')), '192.0.2.3')
  const uneven = createClientIpResolver('192.0.2.128/25,2001:db8::/65')
  assert.equal(uneven(request('192.0.2.127', '198.51.100.3')), '192.0.2.127')
  assert.equal(uneven(request('192.0.2.128', '198.51.100.3')), '198.51.100.3')
  assert.equal(uneven(request('2001:db8::7', '198.51.100.3')), '198.51.100.3')
  assert.equal(uneven(request('2001:db8:0:0:8000::7', '198.51.100.3')), '2001:db8:0:0:8000:0:0:7')
})

test('Missing, ambiguous, malformed or excessive XFF falls back to socket quota', () => {
  for (const header of [undefined, '', ' ', [], ['192.0.2.1'], 'unknown',
    '192.0.2.1,', ',192.0.2.1', 'garbage, 192.0.2.1', '192.0.2.1:1234',
    '[2001:db8::1]', 'for=192.0.2.1', '"192.0.2.1"', '192.000.2.1',
    '127.1', '2130706433', '0x7f000001', 'fe80::1%eth0', '::ffff:999.0.0.1',
    '2001:::1', Array(33).fill('192.0.2.1').join(','), ' '.repeat(4097)]) {
    assert.equal(resolve(request('127.0.0.1', header)), '127.0.0.1')
  }
  const duplicate = request('127.0.0.1', '192.0.2.1,192.0.2.2')
  duplicate.rawHeaders = ['X-Forwarded-For', '192.0.2.1', 'x-forwarded-for', '192.0.2.2']
  assert.equal(resolve(duplicate), '127.0.0.1')
})

test('Missing or invalid socket never promotes XFF; unknown uses shared bounded quota', () => {
  const limiter = createRegisterLimiter({ limit: 1 })
  for (const address of [undefined, '', 'invalid', '[::1]', '127.1', 'fe80::1%eth0'])
    assert.equal(resolve(request(address, '192.0.2.1')), 'unknown')
  assert.equal(resolve({ headers: { 'x-forwarded-for': '192.0.2.1' } }), 'unknown')
  assert.equal(limiter(resolve(request(undefined, '192.0.2.1'))).allowed, true)
  assert.equal(limiter(resolve(request('bad', '192.0.2.2'))).allowed, false)
})

test('Invalid config and explicit/combined trust-all fail at startup', () => {
  for (const value of [null, true, ['127.0.0.1'], '*', 'true', '1', 'loopback',
    'localhost', 'https://127.0.0.1', '127.0.0.1:3001', '127.0.0.1,',
    '127.0.0.1,,::1', '127.1', 'fe80::1%2', '192.0.2.0/-1', '192.0.2.0/33',
    '192.0.2.0/', '192.0.2.0/01', '192.0.2.0/1e1', '::1/129', '::1/64/64',
    '0.0.0.0/0', '::/0', '::ffff:0:0/96', '::ffff:192.0.2.0/95',
    '0.0.0.0/1,128.0.0.0/1', '::/1,8000::/1',
    Array(65).fill('127.0.0.1').join(','), ' '.repeat(8193)])
    assert.throws(() => createClientIpResolver(value), /TRUSTED_PROXY_CIDRS/)
  assert.throws(() => createAppServer({ trustedProxyCidrs: '*' }), /TRUSTED_PROXY_CIDRS/)
  assert.equal(createClientIpResolver('   ')(request('192.0.2.1', '192.0.2.2')), '192.0.2.1')
})

test('Separate clients get separate quotas; forged prefix cannot reset same client quota', () => {
  const limiter = createRegisterLimiter({ limit: 1 })
  assert.equal(limiter(resolve(request('127.0.0.1', '192.0.2.1'))).allowed, true)
  assert.equal(limiter(resolve(request('127.0.0.1', '192.0.2.2'))).allowed, true)
  assert.equal(limiter(resolve(request('127.0.0.1', '203.0.113.99, 192.0.2.1'))).allowed, false)
  assert.equal(limiter(resolve(request('127.0.0.1', '::ffff:c000:201'))).allowed, false)
  const direct = createClientIpResolver()
  const sameSocket = createRegisterLimiter({ limit: 1 })
  assert.equal(sameSocket(direct(request('192.0.2.1', '203.0.113.1'))).allowed, true)
  assert.equal(sameSocket(direct(request('192.0.2.1', '203.0.113.2'))).allowed, false)
})

test('Server reads explicit environment policy and rejects invalid config without logging its value', () => {
  const script = `
    import { createAppServer } from './backend/server.mjs'
    try { createAppServer(); process.exit(2) }
    catch (error) {
      if (!error.message.startsWith('TRUSTED_PROXY_CIDRS')) process.exit(3)
      process.stdout.write('CONFIG_REJECTED')
    }
  `
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, TRUSTED_PROXY_CIDRS: 'invalid-policy-fixture' },
    windowsHide: true,
    encoding: 'utf8',
  }), 'CONFIG_REJECTED')
})
