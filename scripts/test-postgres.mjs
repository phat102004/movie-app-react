import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readNativeTestConfig } from '../backend/integration/config.mjs'

try {
  readNativeTestConfig()
  const env = { ...process.env, NODE_ENV: 'test' }
  // Never give integration services a fallback to developer/production secrets.
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_HOST',
    'TMDB_READ_ACCESS_TOKEN', 'SMTP_USER', 'SMTP_PASSWORD']) env[name] = ''
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--test', '--test-concurrency=1', 'backend/integration/native.test.mjs'], {
      env, windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024,
    })
  process.stdout.write(stdout)
} catch (error) {
  // Do not echo native driver/Prisma errors containing DSNs, SQL values or tokens.
  if (typeof error.stdout === 'string')
    process.stderr.write(error.stdout.split('\n').filter(line => /^\s*(?:not ok|# tests|# pass|# fail)/.test(line)).join('\n') + '\n')
  console.error('Native PostgreSQL gate failed. Verify disposable target/opt-in, migrations and the named failed test; connection details hidden.')
  process.exitCode = 1
}
