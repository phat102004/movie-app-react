import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { readRuntimeDatabaseConfig, readMigrationDatabaseConfig, prismaDatasourceUrl } from '../database/connection-config.mjs'
import { DatabaseConfigError, databaseErrorMessage } from '../database/config.mjs'
import { applicationTables, validateProductionRole, inspectRoleSecurity } from '../database/role-security.mjs'
import { reviewedProductionMigrations, productionMigrationState } from '../database/production-migration-plan.mjs'
import { knownMigrations } from '../database/inspect.mjs'

const local = 'postgresql://postgres:synthetic-local-password@localhost:5432/cineverse_dev?schema=public'
const uri = role => `postgresql://${role}:synthetic-production-password@db.fixture.test:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict`
const env = () => ({ NODE_ENV: 'production', PRODUCTION_DATABASE_HOST: 'db.fixture.test',
  DATABASE_URL: uri('cineverse_app'), MIGRATION_DATABASE_URL: uri('cineverse_migrator') })
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('Local URL guard/offline workflow unchanged; migration override is used only by migration/Prisma CLI', () => {
  const values = { DATABASE_URL: local }
  assert.equal(readRuntimeDatabaseConfig(values).driver.database, 'cineverse_dev')
  assert.equal(readMigrationDatabaseConfig(values).connectionString, readRuntimeDatabaseConfig(values).connectionString)
  values.MIGRATION_DATABASE_URL = local.replace('://postgres:', '://fixture_migrator:')
  assert.equal(readMigrationDatabaseConfig(values).driver.user, 'fixture_migrator')
  assert.equal(readRuntimeDatabaseConfig(values).driver.user, 'postgres')
  assert.equal(prismaDatasourceUrl(values), readMigrationDatabaseConfig(values).connectionString)
  assert.equal(prismaDatasourceUrl({}), undefined)
  assert.throws(() => readMigrationDatabaseConfig({ MIGRATION_DATABASE_URL: uri('cineverse_migrator') }), DatabaseConfigError)
})

test('Production runtime/CLI choose distinct named roles, explicit host/target and verified TLS', () => {
  const values = env(), app = readRuntimeDatabaseConfig(values), migrator = readMigrationDatabaseConfig(values)
  assert.equal(app.driver.user, 'cineverse_app')
  assert.equal(migrator.driver.user, 'cineverse_migrator')
  assert.equal(app.driver.ssl.rejectUnauthorized, true)
  assert.equal(app.driver.ssl.servername, 'db.fixture.test')
  assert.equal(app.driver.options, '-c search_path=pg_catalog,public')
  assert.equal(migrator.driver.max, 1)
  assert.equal(app.driver.max, 3)
  assert.equal(prismaDatasourceUrl(values), migrator.connectionString)
  delete values.DATABASE_URL
  assert.equal(readMigrationDatabaseConfig(values).driver.user, 'cineverse_migrator')
  assert.throws(() => readRuntimeDatabaseConfig(values), DatabaseConfigError)
})

test('Production never falls back to runtime credentials for CLI or to local configuration', () => {
  for (const values of [
    { NODE_ENV: 'production' }, { ...env(), MIGRATION_DATABASE_URL: '' },
    { ...env(), MIGRATION_DATABASE_URL: local },
    { ...env(), MIGRATION_DATABASE_URL: uri('cineverse_app') },
    { ...env(), PRODUCTION_DATABASE_HOST: '' }, { NODE_ENV: 'unexpected', DATABASE_URL: local },
  ]) assert.throws(() => prismaDatasourceUrl(values), DatabaseConfigError)
  for (const value of [local, uri('postgres'), uri('cineverse_migrator'),
    uri('cineverse_app').replace('cineverse_prod', 'cineverse_dev'),
    uri('cineverse_app').replace('5432', '6432'),
    uri('cineverse_app').replace('public', 'private'),
    uri('cineverse_app').replace('sslmode=require', 'sslmode=disable'),
    uri('cineverse_app').replace('sslaccept=strict', 'sslaccept=accept_invalid_certs'),
    uri('cineverse_app') + '&sslaccept=strict', uri('cineverse_app') + '&options=-c%20role=postgres',
    uri('cineverse_app') + '&host=127.0.0.1', uri('cineverse_app') + '#fragment',
    uri('cineverse_app').replace('synthetic-production-password', '%3CPASSWORD%3E'),
    uri('cineverse_app').replace('synthetic-production-password', '%ZZ'),
  ]) assert.throws(() => readRuntimeDatabaseConfig({ ...env(), DATABASE_URL: value }), DatabaseConfigError)
  for (const host of ['localhost', '127.0.0.1', '::1', 'db..fixture.test', '-db.fixture.test', 'db.fixture.test.'])
    assert.throws(() => readRuntimeDatabaseConfig({ ...env(), PRODUCTION_DATABASE_HOST: host }), DatabaseConfigError)
})

test('CA path is explicit/absolute, shared with CLI, and rejects private key/non-certificate data without echoing path', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cineverse-ca-fixture-'))
  const path = join(dir, 'public-ca.pem')
  t.after(() => { unlinkSync(path); rmdirSync(dir) })
  writeFileSync(path, rootCertificates[0]) // Public trust anchor, not a credential.
  const values = { ...env(), DATABASE_SSL_CA_FILE: path }
  assert.equal(readRuntimeDatabaseConfig(values).driver.ssl.ca, readFileSync(path, 'utf8'))
  assert.equal(new URL(prismaDatasourceUrl(values)).searchParams.get('sslcert'), path)
  for (const ca of ['not a certificate', '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----']) {
    writeFileSync(path, ca)
    assert.throws(() => readRuntimeDatabaseConfig(values), error => !error.message.includes(path))
  }
  assert.throws(() => readRuntimeDatabaseConfig({ ...env(), DATABASE_SSL_CA_FILE: './relative.pem' }), DatabaseConfigError)
})

function snapshot(purpose = 'runtime') {
  const runtime = purpose === 'runtime'
  return {
    identity: { database: 'cineverse_prod', role: runtime ? 'cineverse_app' : 'cineverse_migrator',
      sessionRole: runtime ? 'cineverse_app' : 'cineverse_migrator', canLogin: true,
      superuser: false, createDb: false, createRole: false, replication: false, bypassRls: false,
      inherit: false, memberships: 0, dbOwner: false, dbConnect: true, dbTemp: false,
      dbCreate: !runtime, otherDatabaseConnect: false, ownsObjects: !runtime, unsafeRoutines: false },
    schemas: [{ name: 'public', owner: false, usage: true, create: !runtime }],
    tables: [...applicationTables, '_prisma_migrations'].map(name => ({ schema: 'public', name, kind: 'r', owner: !runtime,
      select: !runtime || name !== '_prisma_migrations', insert: !runtime || name !== '_prisma_migrations',
      update: !runtime || name !== '_prisma_migrations', delete: !runtime || name !== '_prisma_migrations',
      truncate: !runtime, references: !runtime, trigger: !runtime, grantOption: !runtime,
      columnAccess: !runtime || name !== '_prisma_migrations', columnGrantOption: !runtime })),
    sequences: [],
  }
}

for (const purpose of ['runtime', 'migration']) {
  test(`${purpose}: rejects elevated role attributes, memberships, wrong identity, PUBLIC other-DB access`, () => {
    validateProductionRole(snapshot(purpose), purpose)
    for (const [key, value] of Object.entries({ database: 'cineverse_dev', role: 'postgres', sessionRole: 'postgres',
      canLogin: false, superuser: true, createDb: true, createRole: true, replication: true, bypassRls: true,
      inherit: true, memberships: 1, dbOwner: true, dbConnect: false, dbTemp: true,
      dbCreate: purpose === 'runtime', otherDatabaseConnect: true })) {
      const input = snapshot(purpose)
      input.identity[key] = value
      assert.throws(() => validateProductionRole(input, purpose), DatabaseConfigError, key)
    }
  })
}

test('Runtime cannot own/create schema or objects, grant DML, truncate, read history, or access unreviewed tables/sequences', () => {
  const variants = [
    input => { input.identity.ownsObjects = true },
    input => { input.identity.unsafeRoutines = true },
    input => { input.schemas[0].create = true }, input => { input.schemas[0].owner = true },
    input => { input.tables[0].select = false }, input => { input.tables[0].grantOption = true },
    input => { input.tables[0].columnGrantOption = true }, input => { input.tables[4].columnAccess = true },
    input => { input.tables[0].truncate = true }, input => { input.tables[4].select = true },
    input => { input.tables.push({ ...input.tables[0], name: 'UnreviewedTable' }) },
    input => { input.sequences.push({ usage: true }) }, input => { input.tables.shift() },
  ]
  for (const change of variants) {
    const input = snapshot(); change(input)
    assert.throws(() => validateProductionRole(input, 'runtime'), DatabaseConfigError)
  }
})

test('Migrator requires ownership to ALTER existing tables; table grants alone are insufficient', () => {
  const input = snapshot('migration')
  input.tables[0].owner = false
  assert.throws(() => validateProductionRole(input, 'migration'), /OWNERSHIP/)
  input.tables = []
  validateProductionRole(input, 'migration') // Fresh, pre-migration database.
})

test('Production migration guard pins unchanged SQL, recognizes prefixes and refuses unknown history/inventory', async () => {
  const expected = await reviewedProductionMigrations()
  assert.deepEqual(expected.map(row => row.name), knownMigrations)
  const input = count => ({ database: 'cineverse_prod',
    objects: applicationTables.slice(0, count).map(name => ({ name, schema: 'public', kind: 'r' })),
    migrations: expected.slice(0, count).map(row => ({ name: row.name, checksum: row.checksums[0], finished: new Date(), rolled_back: null })),
  })
  for (const count of [0, 1, 2, 3, 4]) assert.equal(productionMigrationState(input(count), expected), count)
  const wrongChecksum = input(4); wrongChecksum.migrations[0].checksum = 'changed'
  const failed = input(1); failed.migrations[0].finished = null
  for (const invalid of [wrongChecksum, failed, { ...input(4), database: 'cineverse_dev' },
    { ...input(4), objects: [] }, { ...input(0), objects: [{ name: 'Existing', schema: 'public', kind: 'r' }] }])
    assert.throws(() => productionMigrationState(invalid, expected), DatabaseConfigError)
})

test('Production SQL is opt-in, target-guarded, no passwords/owner transfer/ALL grants/default history exposure', () => {
  const bootstrap = read('database/production-roles.sql'), grants = read('database/production-runtime-grants.sql')
  assert.match(bootstrap, /\\if :\{\?CINEVERSE_PROVISION\}/)
  assert.match(grants, /\\if :\{\?CINEVERSE_GRANT_RUNTIME\}/)
  for (const sql of [bootstrap, grants]) {
    assert.match(sql, /current_database\(\) = 'cineverse_prod'/)
    const code = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    assert.doesNotMatch(code, /\b(DROP|TRUNCATE|DELETE FROM|REASSIGN OWNED|OWNER TO|GRANT ALL PRIVILEGES|ON ALL TABLES)\b/i)
  }
  for (const name of ['cineverse_app', 'cineverse_migrator'])
    assert.match(bootstrap, new RegExp(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE\\s+NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL`))
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/)
  assert.doesNotMatch(grants.split('\n').filter(line => !line.trim().startsWith('--')).join('\n'), /GRANT[^;]*_prisma_migrations/s)
  assert.doesNotMatch(bootstrap, /GRANT cineverse_migrator TO cineverse_app/)
})

test('Runtime/migrator factories and CLI select the correct purpose; deployment output hides raw child errors', () => {
  assert.match(read('database/client.mjs'), /createDatabaseClient\(readRuntimeDatabaseConfig\(\)\)/)
  assert.match(read('database/migration-client.mjs'), /createDatabaseClient\(readMigrationDatabaseConfig\(\)\)/)
  assert.match(read('prisma.config.mjs'), /url: prismaDatasourceUrl\(\)/)
  assert.match(read('scripts/migrate.mjs'), /NODE_ENV === 'production'/)
  const deploy = read('scripts/deploy-production.mjs')
  assert.match(deploy, /getMigrationPrisma\(\)/)
  assert.doesNotMatch(deploy, /console\.(?:log|error)\([^)]*(?:stdout|stderr|connectionString|\.stack)/)
  for (const bad of ['not-a-url', uri('postgres'), uri('cineverse_app') + '&host=attacker.fixture.test']) {
    try { readRuntimeDatabaseConfig({ ...env(), DATABASE_URL: bad }) }
    catch (error) {
      const message = databaseErrorMessage(error)
      assert.equal(message.includes('synthetic-production-password'), false)
      assert.equal(message.includes('postgresql://'), false)
    }
  }
})

test('Production CLI guards fail before connecting when env/purpose is wrong; messages contain no URL/password', () => {
  for (const [script, nodeEnv] of [
    ['deploy-production.mjs', 'test'], ['deploy-production.mjs', 'production'],
    ['check-production-roles.mjs', 'test'], ['check-production-roles.mjs', 'production'],
    ['migrate.mjs', 'production'],
  ]) {
    const result = spawnSync(process.execPath, [`backend/scripts/${script}`], {
      env: { ...process.env, NODE_ENV: nodeEnv, DATABASE_URL: '', MIGRATION_DATABASE_URL: '', PRODUCTION_DATABASE_HOST: '' },
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    })
    assert.equal(result.status, 1, script)
    assert.equal(result.stdout.includes('postgresql://'), false)
    assert.equal(result.stderr.includes('synthetic-production-password'), false)
    assert.equal(result.stderr.includes('postgresql://'), false)
  }
})

test('PostgreSQL WASM RAM ACL integration: migrator applies four unchanged migrations; runtime CRUD/locks only', { timeout: 30_000 }, async () => {
  // No dataDir, TCP socket, .env, real roles or real PostgreSQL account.
  const db = new PGlite()
  try {
    const section = (sql, name) => sql.split(`-- ${name}_BEGIN`)[1].split(`-- ${name}_END`)[0]
    // RAM database is named postgres. Only the fixture database identifier changes.
    await db.exec(section(read('database/production-roles.sql'), 'BOOTSTRAP').replaceAll('cineverse_prod', 'postgres'))
    await db.exec('SET ROLE cineverse_migrator')
    for (const migration of knownMigrations) await db.exec(read(`prisma/migrations/${migration}/migration.sql`))
    await db.exec('CREATE TABLE public._prisma_migrations (id text PRIMARY KEY)')
    await db.exec('ALTER TABLE public."User" ADD COLUMN fixture_column integer')
    await db.exec('RESET ROLE')
    await db.exec(section(read('database/production-runtime-grants.sql'), 'RUNTIME_GRANTS'))
    await db.exec('SET SESSION AUTHORIZATION cineverse_app')
    const client = { $queryRaw: async strings => (await db.query(strings.join(''))).rows }
    const rights = await inspectRoleSecurity(client)
    assert.equal(rights.identity.role, 'cineverse_app')
    assert.equal(rights.identity.superuser, false)
    assert.equal(rights.identity.dbCreate, false)
    assert.equal(rights.identity.dbTemp, false)
    assert.equal(rights.identity.ownsObjects, false)
    assert.equal(rights.schemas.find(row => row.name === 'public').create, false)
    const id = '00000000-0000-4000-8000-000000000001'
    await db.query('INSERT INTO public."User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
      [id, 'synthetic@fixture.test', 'Synthetic', 'synthetic-not-a-password-hash'])
    await db.query('UPDATE public."User" SET name=$1 WHERE id=$2', ['Synthetic Updated', id])
    assert.equal((await db.query('SELECT id FROM public."User" WHERE id=$1 FOR UPDATE', [id])).rows.length, 1)
    const childIds = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004']
    await db.query('INSERT INTO public."Session" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,NOW()+INTERVAL \'1 day\')',
      [childIds[0], id, 'synthetic-session-role-fixture'.padEnd(64, 'x')])
    await db.query('INSERT INTO public."PasswordResetToken" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,NOW()+INTERVAL \'20 minutes\')',
      [childIds[1], id, 'synthetic-reset-role-fixture'.padEnd(64, 'x')])
    await db.query('INSERT INTO public."Favorite" (id,"userId","movieId") VALUES ($1,$2,$3)', [childIds[2], id, 27205])
    await db.query('UPDATE public."Session" SET "expiresAt"=NOW()+INTERVAL \'2 days\' WHERE id=$1', [childIds[0]])
    await db.query('UPDATE public."PasswordResetToken" SET "expiresAt"=NOW()+INTERVAL \'30 minutes\' WHERE id=$1', [childIds[1]])
    await db.query('UPDATE public."Favorite" SET "movieId"=$1 WHERE id=$2', [550, childIds[2]])
    for (const [index, name] of ['Session', 'PasswordResetToken', 'Favorite'].entries()) {
      // Names are a hardcoded test allowlist, never request input.
      assert.equal((await db.query(`SELECT id FROM public."${name}" WHERE id=$1 FOR UPDATE`, [childIds[index]])).rows.length, 1)
      await db.query(`DELETE FROM public."${name}" WHERE id=$1`, [childIds[index]])
    }
    for (const sql of ['CREATE SCHEMA forbidden_fixture', 'ALTER SCHEMA public RENAME TO forbidden_fixture',
      'ALTER TABLE public."User" ADD COLUMN forbidden_fixture integer',
      'SELECT * FROM public._prisma_migrations', 'SET ROLE cineverse_migrator'])
      await assert.rejects(db.exec(sql), error => error.code === '42501')
    await db.query('DELETE FROM public."User" WHERE id=$1', [id])
    assert.equal((await db.query('SELECT * FROM public."User"')).rows.length, 0)
    for (const name of applicationTables) {
      const row = rights.tables.find(row => row.name === name)
      assert.equal([row.select, row.insert, row.update, row.delete].every(Boolean), true)
      assert.equal(row.grantOption, false)
    }
  } finally { await db.close() }
})
