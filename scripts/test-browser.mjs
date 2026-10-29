import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const run = promisify(execFile)
const require = createRequire(import.meta.url)
const playwright = require.resolve('playwright')
const suites = [
  ['auth.browser.cjs', '--regression'], ['authLayout.browser.cjs'],
  ['favorites.browser.cjs'], ['profile.browser.cjs'], ['changePassword.browser.cjs'],
  ['multitabAuth.browser.cjs'], ['auditRemediation.browser.cjs'],
]
for (const [suite, ...args] of suites) {
  console.info(`Browser regression: ${suite}`)
  try {
    const { stdout } = await run(process.execPath, [`frontend/tests/${suite}`, playwright, ...args], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
      timeout: 240_000, maxBuffer: 1024 * 1024,
    })
    process.stdout.write(stdout)
  } catch {
    // Browser errors may contain form values/reset URLs. Do not dump raw errors.
    console.error(`Browser suite failed: ${suite}. Sensitive details hidden.`)
    process.exitCode = 1
    break
  }
}
