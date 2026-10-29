import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
const { safeBrowserFailure } = createRequire(import.meta.url)('../../frontend/tests/browser-diagnostics.cjs')

test('browser failure diagnostics reveal test location but no message, reset URL, input, cookie or arbitrary name', () => {
  const secret = 'synthetic-private-browser-value'
  const stack = `Error: ${secret}\n    at /private/${secret}/frontend/tests/auth.browser.cjs:42:7\n    at outside (${secret}:1:2)`
  const output = safeBrowserFailure('auth.browser.cjs', { name: 'TimeoutError', message: `https://fixture.test/reset-password#token=${secret}`, stack })
  assert.equal(output, 'SAFE_BROWSER_FAILURE auth.browser.cjs: TimeoutError; locations=auth.browser.cjs:42:7')
  assert.equal(output.includes(secret), false)
  assert.equal(safeBrowserFailure('auth.browser.cjs', { name: 'Error', stderr: `private ${secret}\n    at run (/runner/frontend/tests/movieDetails.browser.cjs:12:3)` }),
    'SAFE_BROWSER_FAILURE auth.browser.cjs: Error; locations=movieDetails.browser.cjs:12:3')
  assert.equal(safeBrowserFailure(secret, { name: secret, stack: secret }), 'SAFE_BROWSER_FAILURE unknown.browser.cjs: Unknown; locations=none')
})
