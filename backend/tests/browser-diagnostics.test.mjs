import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
const { safeBrowserFailure, browserFailureReport } = createRequire(import.meta.url)('../../frontend/tests/browser-diagnostics.cjs')

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

test('runner preserves redacted child error kind, source location and fixed checkpoint', () => {
  const secret = 'synthetic-private-browser-value'
  // Old child output has no stack and is rejected by the runner's safe format.
  assert.deepEqual(browserFailureReport('changePassword.browser.cjs', {
    name: 'Error',
    stderr: 'Change Password browser verification failed at validation; TimeoutError; input/credentials hidden.',
  }), ['SAFE_BROWSER_FAILURE changePassword.browser.cjs: Error; locations=none'])
  const report = safeBrowserFailure('changePassword.browser.cjs', {
    name: 'TimeoutError', message: secret,
    stack: `TimeoutError: ${secret}\n    at main (/private/${secret}/frontend/tests/changePassword.browser.cjs:201:9)`,
  }, 'validation')
  assert.equal(report, 'SAFE_BROWSER_FAILURE changePassword.browser.cjs: TimeoutError; locations=changePassword.browser.cjs:201:9; checkpoint=validation')
  const output = browserFailureReport('changePassword.browser.cjs', {
    name: 'Error', stderr: `${secret}\n${report}\nprivate input ${secret}`,
  })
  assert.deepEqual(output, [report])
  assert.equal(output.join().includes(secret), false)
})

test('runner rejects injected diagnostics and arbitrary checkpoint values', () => {
  const suite = 'changePassword.browser.cjs'
  const fallback = 'SAFE_BROWSER_FAILURE changePassword.browser.cjs: Error; locations=none'
  for (const line of [
    'SAFE_BROWSER_FAILURE auth.browser.cjs: Error; locations=none',
    'SAFE_BROWSER_FAILURE changePassword.browser.cjs: Error; locations=none; checkpoint=synthetic-private-value',
    'SAFE_BROWSER_FAILURE changePassword.browser.cjs: Error; locations=none; message=synthetic-private-value',
    'SAFE_BROWSER_FAILURE changePassword.browser.cjs: Error; locations=synthetic-private-value',
  ]) assert.deepEqual(browserFailureReport(suite, { name: 'Error', stderr: line }), [fallback])
  assert.equal(safeBrowserFailure(suite, { name: 'Error' }, 'synthetic-private-value'), fallback)
  assert.equal(safeBrowserFailure('auth.browser.cjs', { name: 'Error' }, 'validation'),
    'SAFE_BROWSER_FAILURE auth.browser.cjs: Error; locations=none')
})
