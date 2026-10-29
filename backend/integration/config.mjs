// Dedicated disposable PostgreSQL only. Never import/load backend/.env here.
export const nativeDatabase = 'cineverse_ci'
export const nativeCluster = 'cineverse_native_disposable'
export const bootstrapRole = 'cineverse_ci_bootstrap'
export const nativeOptIn = 'allow-isolated-native-tests'
export const runtimePassword = 'ci-ephemeral-runtime-fixture-only'
export const migratorPassword = 'ci-ephemeral-migrator-fixture-only'
const fail = () => { throw new Error('Native tests require explicit opt-in, loopback non-5432 port, cineverse_ci and disposable bootstrap credentials. No DATABASE_URL fallback; details hidden.') }

export function readNativeTestConfig(env = process.env) {
  if (env.CINEVERSE_NATIVE_TESTS !== nativeOptIn) fail()
  let url
  try { url = new URL(env.CINEVERSE_CI_DATABASE_URL) } catch { fail() }
  let user, password
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password) } catch { fail() }
  const port = Number(url.port)
  const serverPort = env.CINEVERSE_CI_SERVER_PORT === undefined ? port
    : /^[1-9]\d*$/.test(env.CINEVERSE_CI_SERVER_PORT) ? Number(env.CINEVERSE_CI_SERVER_PORT) : NaN
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432 ||
      url.pathname !== '/' + nativeDatabase || url.search || url.hash ||
      user !== bootstrapRole || !/^ci-ephemeral-[a-zA-Z0-9-]{12,100}$/.test(password)) fail()
  if (!Number.isInteger(serverPort) || serverPort < 1024 || serverPort > 65535) fail()
  const driver = {
    host: '127.0.0.1', port, database: nativeDatabase, user, password,
    ssl: false, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
    statement_timeout: 10_000, query_timeout: 15_000,
    options: '-c search_path=pg_catalog,public',
    application_name: 'cineverse-native-bootstrap', max: 3,
  }
  function asRole(role, secret) {
    const connection = new URL(url)
    connection.username = role
    connection.password = secret
    connection.searchParams.set('schema', 'public')
    return {
      // Isolated test target cannot pass the strict production DB-name/TLS guard.
      // The production PrismaPg factory is reused, with native ACL checks in tests.
      production: false,
      connectionString: connection.href,
      driver: { ...driver, user: role, password: secret, application_name: 'cineverse-native-' + role },
    }
  }
  return { driver, serverPort, runtime: asRole('cineverse_app', runtimePassword), migration: asRole('cineverse_migrator', migratorPassword) }
}
