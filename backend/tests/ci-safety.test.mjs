import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { readNativeTestConfig, nativeOptIn } from '../integration/config.mjs'
import { validateProductionConfig } from '../production-readiness.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { sessionCookie } from '../auth/cookies.mjs'

const native = () => ({ CINEVERSE_NATIVE_TESTS: nativeOptIn,
  CINEVERSE_CI_DATABASE_URL: 'postgresql://cineverse_ci_bootstrap:ci-ephemeral-bootstrap-fixture-only@127.0.0.1:55432/cineverse_ci' })
const production = () => ({ NODE_ENV: 'production', AUTH_ALLOWED_ORIGINS: 'https://cineverse.fixture.test',
  DATABASE_URL: 'postgresql://cineverse_app:synthetic-runtime-password@db.fixture.test:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict',
  MIGRATION_DATABASE_URL: 'postgresql://cineverse_migrator:synthetic-migration-password@db.fixture.test:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict',
  PRODUCTION_DATABASE_HOST: 'db.fixture.test', TMDB_READ_ACCESS_TOKEN: 'synthetic-TMDB-offline-fixture-only', PASSWORD_RESET_EMAIL_MODE: 'disabled' })

test('native guard accepts only explicit disposable loopback target and never falls back to DATABASE_URL', () => {
  assert.equal(readNativeTestConfig(native()).driver.database, 'cineverse_ci')
  for (const url of ['', 'not-a-url', native().CINEVERSE_CI_DATABASE_URL.replace(':55432/', ':5432/'),
    native().CINEVERSE_CI_DATABASE_URL.replace('/cineverse_ci', '/cineverse_dev'),
    native().CINEVERSE_CI_DATABASE_URL.replace('/cineverse_ci', '/cineverse_prod'),
    native().CINEVERSE_CI_DATABASE_URL.replace('127.0.0.1', 'db.fixture.test'),
    native().CINEVERSE_CI_DATABASE_URL + '?host=remote.fixture.test',
    native().CINEVERSE_CI_DATABASE_URL.replace('ci-ephemeral-bootstrap-fixture-only', 'not-a-disposable-password')]) {
    assert.throws(() => readNativeTestConfig({ ...native(), CINEVERSE_CI_DATABASE_URL: url, DATABASE_URL: native().CINEVERSE_CI_DATABASE_URL }))
  }
  assert.throws(() => readNativeTestConfig({ ...native(), CINEVERSE_NATIVE_TESTS: '' }))
})

test('native guard distinguishes published endpoint from expected internal server port without allowing host port 5432', () => {
  const config = readNativeTestConfig({ ...native(), CINEVERSE_CI_SERVER_PORT: '5432' })
  assert.equal(config.driver.port, 55432)
  assert.equal(config.serverPort, 5432)
  assert.equal(readNativeTestConfig(native()).serverPort, 55432)
  for (const value of ['', '0', '65536', 'invalid', '5e3'])
    assert.throws(() => readNativeTestConfig({ ...native(), CINEVERSE_CI_SERVER_PORT: value }))
  assert.throws(() => readNativeTestConfig({ ...native(), CINEVERSE_CI_SERVER_PORT: '5432',
    CINEVERSE_CI_DATABASE_URL: native().CINEVERSE_CI_DATABASE_URL.replace(':55432/', ':5432/') }))
})

test('native runner missing opt-in fails nonzero before connection and hides supplied URL', () => {
  const result = spawnSync(process.execPath, ['scripts/test-postgres.mjs'], {
    env: { ...process.env, CINEVERSE_NATIVE_TESTS: '', CINEVERSE_CI_DATABASE_URL: native().CINEVERSE_CI_DATABASE_URL },
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  })
  assert.equal(result.status, 1)
  assert.equal((result.stdout + result.stderr).includes('postgresql://'), false)
  assert.equal((result.stdout + result.stderr).includes('ci-ephemeral-bootstrap-fixture-only'), false)
})

test('offline production gate requires explicit environment, HTTPS origins, strict TLS and distinct role secrets', () => {
  assert.equal(validateProductionConfig(production()).recoveryEnabled, false)
  for (const patch of [{ NODE_ENV: undefined }, { NODE_ENV: 'test' }, { AUTH_ALLOWED_ORIGINS: 'http://localhost:5173' },
    { DATABASE_URL: '' }, { MIGRATION_DATABASE_URL: '' },
    { DATABASE_URL: production().DATABASE_URL.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs') },
    { MIGRATION_DATABASE_URL: production().MIGRATION_DATABASE_URL.replace('synthetic-migration-password', 'synthetic-runtime-password') },
    { TMDB_READ_ACCESS_TOKEN: '' }, { TMDB_READ_ACCESS_TOKEN: 'your_tmdb_read_access_token' },
    { TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }, { TMDB_MAX_CONCURRENT: '0' }, { TMDB_MAX_QUEUE: '99999' }])
    assert.throws(() => validateProductionConfig({ ...production(), ...patch }))
  const cookie = sessionCookie('synthetic-cookie-fixture', readAuthConfig(production()))
  for (const flag of ['__Host-cineverse_session=', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag))
})

test('production recovery is explicitly disabled or SMTP requires TLS, credentials and an approved HTTPS origin', () => {
  const smtp = { ...production(), PASSWORD_RESET_EMAIL_MODE: 'smtp', PUBLIC_APP_ORIGIN: 'https://cineverse.fixture.test',
    SMTP_HOST: 'smtp.fixture.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_FROM: 'cineverse@fixture.test',
    SMTP_USER: 'synthetic-smtp-fixture', SMTP_PASSWORD: 'synthetic-smtp-password' }
  assert.equal(validateProductionConfig(smtp).recoveryEnabled, true)
  for (const patch of [{ PASSWORD_RESET_EMAIL_MODE: 'local' }, { SMTP_PASSWORD: '' }, { SMTP_SECURE: 'invalid' },
    { PUBLIC_APP_ORIGIN: 'https://unapproved.fixture.test' }])
    assert.throws(() => validateProductionConfig({ ...smtp, ...patch }))
})

test('production config CLI fails closed without reading .env or printing environment values', () => {
  const result = spawnSync(process.execPath, ['scripts/check-production-config.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', AUTH_ALLOWED_ORIGINS: '', DATABASE_URL: 'synthetic-must-not-log' },
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  })
  assert.equal(result.status, 1)
  assert.equal((result.stdout + result.stderr).includes('synthetic-must-not-log'), false)
})
