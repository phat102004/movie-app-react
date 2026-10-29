// Optional local verification on a NEW cluster. Never uses backend/.env or :5432.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { Client } from 'pg'
import { bootstrapRole, nativeOptIn, nativeCluster } from '../backend/integration/config.mjs'

const run = promisify(execFile)
let cluster, data, startAttempted = false
const bin = process.env.CINEVERSE_PG_BIN
const binary = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
const options = { windowsHide: true, timeout: 60_000, maxBuffer: 512_000 }
async function stopPrivateCluster() {
  try { await run(binary('pg_ctl'), ['-D', data, 'status'], options) }
  catch (error) { if (error.code === 3) return; throw error }
  await run(binary('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], options)
}
try {
  if (!bin) throw new Error('CINEVERSE_PG_BIN required')
  const root = resolve('.npm-cache')
  await mkdir(root, { recursive: true })
  cluster = await mkdtemp(join(root, 'cineverse-native-'))
  data = join(cluster, 'data')
  if (!data.startsWith(root + sep)) throw new Error('Invalid private cluster path')
  const password = 'ci-ephemeral-bootstrap-fixture-only'
  const passwordFile = join(cluster, 'bootstrap-password')
  await writeFile(passwordFile, password + '\n', { mode: 0o600 })
  const probe = createServer()
  await new Promise((resolvePort, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolvePort) })
  const port = probe.address().port
  await new Promise(resolvePort => probe.close(resolvePort))
  if (port === 5432) throw new Error('Refuse developer port')
  await run(binary('initdb'), ['-D', data, '-U', bootstrapRole, '--pwfile', passwordFile,
    '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C',
    '-c', 'cluster_name=' + nativeCluster], options)
  await unlink(passwordFile)
  startAttempted = true
  await run(binary('pg_ctl'), ['-D', data, '-l', join(cluster, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -c max_connections=30 -c ssl=off`, '-w', 'start'], options)
  const admin = new Client({ host: '127.0.0.1', port, user: bootstrapRole, password, database: 'postgres', connectionTimeoutMillis: 5000 })
  try {
    await admin.connect()
    const { rows: [identity] } = await admin.query("SELECT current_user AS role, inet_server_port() AS port, current_setting('cluster_name') AS cluster")
    if (identity.role !== bootstrapRole || identity.port !== port || identity.cluster !== nativeCluster) throw new Error('Private cluster identity mismatch')
    await admin.query('CREATE DATABASE cineverse_ci')
  } finally { await admin.end() }
  const { stdout } = await run(process.execPath, ['scripts/test-postgres.mjs'], {
    ...options, timeout: 200_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, CINEVERSE_NATIVE_TESTS: nativeOptIn, CINEVERSE_CI_SERVER_PORT: String(port),
      CINEVERSE_CI_DATABASE_URL: `postgresql://${bootstrapRole}:${password}@127.0.0.1:${port}/cineverse_ci` },
  })
  process.stdout.write(stdout)
} catch (error) {
  if (typeof error.stderr === 'string' && error.stderr.includes('Native PostgreSQL gate failed'))
    process.stderr.write(error.stderr)
  console.error('Disposable PostgreSQL local run failed; private details hidden. Existing database was not selected or reset.')
  process.exitCode = 1
} finally {
  if (startAttempted) {
    // Also handles a launch command timing out after the server already started.
    try { await stopPrivateCluster() }
    catch { console.error('Could not confirm private test cluster shutdown. Inspect ignored cineverse-native directory.'); process.exitCode = 1 }
  }
  // Keep ignored artifacts for diagnostics. No recursive deletion or DB reset.
}
