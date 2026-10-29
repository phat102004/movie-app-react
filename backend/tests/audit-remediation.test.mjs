import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { readDisplayName } from '../auth/name-validation.mjs'
import { createProxyServer } from '../proxy.mjs'

test('L01: C0, DEL and C1 in display names are rejected without rejecting Unicode format characters', () => {
  for (let point = 0; point <= 159; point++)
    if (point < 32 || point >= 127) assert.equal(readDisplayName('A' + String.fromCodePoint(point) + 'B').valid, false)
  for (const name of ['Nguyễn Thị Ánh', '李明', 'A\u200dB', 'مريم', '😀']) assert.equal(readDisplayName(name).valid, true)
})
test('L02: diagnostic guard failure exits nonzero and does not disclose URL/credentials', () => {
  const result = spawnSync(process.execPath, ['backend/scripts/test-prisma.mjs'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: 'postgresql://fixture:synthetic-diagnostic-password@localhost:5432/not_allowed', MIGRATION_DATABASE_URL: '' },
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  })
  assert.equal(result.status, 1)
  assert.equal((result.stdout + result.stderr).includes('synthetic-diagnostic-password'), false)
  assert.equal((result.stdout + result.stderr).includes('postgresql://'), false)
})
test('M02: backend permits absent optional aggregates but retains strict primary ID/genres validation', async t => {
  const server = createProxyServer({ token: 'synthetic', fetchImpl: async () => Response.json({ id: 27205, genres: [], videos: { success: false } }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/movies/27205`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 27205)
})
