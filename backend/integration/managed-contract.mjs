// Runs only inside the marker/port/empty-cluster-verified native fixture.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Client, Pool } from 'pg'
import { createDatabaseClient } from '../database/client.mjs'
import { inspectManagedRoleSecurity, validateProductionRole } from '../database/role-security.mjs'
import { inspectDatabaseInventory, validateProviderInventory, verifyProviderConnect, probeProviderDatabase } from '../database/provider-connect.mjs'
import { validateNeonEvidence } from '../database/provider-policy.mjs'
import { validateManagedPrivileges } from '../database/managed-privileges.mjs'
import { inspectProductionMigration, productionMigrationState, reviewedProductionMigrations } from '../database/production-migration-plan.mjs'
import { createSessionService } from '../auth/session-service.mjs'
import { createProfileService } from '../profile/profile-service.mjs'
import { createChangePasswordService } from '../profile/change-password-service.mjs'
import { createPasswordResetService } from '../auth/password-reset-service.mjs'
import { hashRegistrationPassword } from '../auth/password.mjs'
import { readAuthConfig } from '../auth/config.mjs'

const adapter = client => ({ $queryRaw: async (strings, ...values) => {
  assert.equal(values.length, 0)
  return (await client.query(strings.join(''))).rows
} })
const safePath = '-c search_path=pg_catalog,public,pg_temp'
const host = 'ep-synthetic.region.aws.neon.tech'
const identity = row => Object.fromEntries(['name','oid','owner','ownerOid'].map(key => [key, row[key]]))

export async function testManagedContract(t, { f, admin, runtime, migrator }) {
  // This role also migrates cineverse_ci in the preceding fixture tests. Remove
  // that unrelated CREATE right while validating the real production-named DB.
  await f.admin.query('REVOKE CREATE ON DATABASE cineverse_ci FROM cineverse_migrator')
  await f.admin.query('CREATE ROLE synthetic_managed_owner NOLOGIN')
  await f.admin.query('ALTER DATABASE postgres OWNER TO synthetic_managed_owner; ALTER DATABASE template1 OWNER TO synthetic_managed_owner')
  await f.admin.query('GRANT CONNECT, TEMP ON DATABASE postgres TO PUBLIC; GRANT CONNECT ON DATABASE template1 TO PUBLIC')
  await admin.query('GRANT CONNECT, TEMP ON DATABASE cineverse_prod TO PUBLIC; GRANT USAGE ON SCHEMA public TO PUBLIC')
  await runtime.query('SET search_path=pg_catalog,public,pg_temp')
  const inventory = await inspectDatabaseInventory(adapter(runtime))
  const policy = validateNeonEvidence({ version: 2, contract: 'managed-postgresql-v1', provider: 'neon', host,
    projectId: 'synthetic-project', branchId: 'br-synthetic', endpointId: 'ep-synthetic', reviewRef: 'synthetic-review',
    reviewedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    target: { ...identity(inventory.find(row => row.name === 'cineverse_prod')), publicTemporary: true, publicSchemaUsage: true },
    systemDatabases: ['postgres','template1'].map(name => ({ ...identity(inventory.find(row => row.name === name)),
      isTemplate: name === 'template1', publicTemporary: name === 'postgres', publicSchemaUsage: true })),
  }, host)
  // The production host/TLS predicates are exercised with synthetic config in
  // unit tests. Only this injected probe seam uses the actual private loopback
  // connection. No native claim about Neon/TLS/provenance is made.
  async function authorize(role = 'cineverse_app', overrideProbe) {
    const connection = role === 'cineverse_app' ? runtime : migrator
    const current = await inspectManagedRoleSecurity(adapter(connection))
    validateManagedPrivileges(current, policy.target, role === 'cineverse_app' ? 'runtime' : 'migration')
    validateProviderInventory(await inspectDatabaseInventory(adapter(connection)), policy, role === 'cineverse_app' ? 'runtime' : 'migration')
    const config = { providerPolicy: policy, driver: { host, port: 5432, database: 'cineverse_prod',
      user: role, ssl: { rejectUnauthorized: true, servername: host } } }
    const driver = role === 'cineverse_app' ? f.config.runtime.driver : f.config.migration.driver
    await verifyProviderConnect(adapter(connection), config, current, client => inspectManagedRoleSecurity(client),
      overrideProbe ?? ((_, expected, inspect) => probeProviderDatabase({ driver }, expected, inspect)))
    validateProductionRole(current, role === 'cineverse_app' ? 'runtime' : 'migration', policy)
    return current
  }
  async function denied(sql, undo) {
    await admin.query(sql)
    try { await assert.rejects(authorize()) }
    finally { await admin.query(undo) }
    await authorize()
  }
  try {
    await t.test('strict rejects effective PUBLIC TEMP while Managed V1 verifies actual app and migrator privileges', async () => {
      const snapshot = await inspectManagedRoleSecurity(adapter(runtime))
      assert.throws(() => validateProductionRole(snapshot, 'runtime'))
      await authorize(); await authorize('cineverse_migrator')
      const expected = await reviewedProductionMigrations()
      assert.equal(productionMigrationState(await inspectProductionMigration(adapter(migrator)), expected), expected.length)
    })
    await t.test('invalid review identity and failed actual provider inspection fail closed', async () => {
      await assert.rejects(authorize('cineverse_app', async () => { throw Error('synthetic denied probe') }))
      const wrong = structuredClone(policy); wrong.systemDatabases[0].ownerOid++
      const { validateProviderInventory } = await import('../database/provider-connect.mjs')
      assert.throws(() => validateProviderInventory(inventory, wrong))
    })
    await admin.query('CREATE SCHEMA pgx; CREATE SCHEMA pgworkspace; CREATE TABLE pgx.managed_extra(id integer, note text); CREATE SEQUENCE pgworkspace.managed_seq')
    await t.test('persistent CREATE and real application ownership stay forbidden', async () => {
      for (const sql of ['CREATE TABLE public.managed_forbidden(id integer)', 'ALTER TABLE public."User" ADD COLUMN forbidden integer',
        'CREATE SCHEMA managed_forbidden', 'TRUNCATE public."Favorite"']) {
        await assert.rejects(runtime.query(sql), error => error.code === '42501')
      }
      await admin.query('ALTER TABLE public."Favorite" OWNER TO cineverse_app')
      try { await assert.rejects(authorize()) }
      finally {
        await admin.query('ALTER TABLE public."Favorite" OWNER TO cineverse_migrator')
        await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON public."Favorite" TO cineverse_app')
      }
      await authorize()
    })
    for (const [name, sql, undo] of [
      ['pgx schema ownership', 'ALTER SCHEMA pgx OWNER TO cineverse_app', 'ALTER SCHEMA pgx OWNER TO cineverse_ci_bootstrap'],
      ['pgworkspace CREATE', 'GRANT CREATE ON SCHEMA pgworkspace TO cineverse_app', 'REVOKE CREATE ON SCHEMA pgworkspace FROM cineverse_app'],
      ['pgx USAGE', 'GRANT USAGE ON SCHEMA pgx TO cineverse_app', 'REVOKE USAGE ON SCHEMA pgx FROM cineverse_app'],
      ['table SELECT', 'GRANT SELECT ON pgx.managed_extra TO cineverse_app', 'REVOKE SELECT ON pgx.managed_extra FROM cineverse_app'],
      ['column SELECT despite no schema USAGE', 'GRANT SELECT(id) ON pgx.managed_extra TO cineverse_app', 'REVOKE SELECT(id) ON pgx.managed_extra FROM cineverse_app'],
      ['sequence USAGE', 'GRANT USAGE ON SEQUENCE pgworkspace.managed_seq TO cineverse_app', 'REVOKE USAGE ON SEQUENCE pgworkspace.managed_seq FROM cineverse_app'],
      ['application MAINTAIN', 'GRANT MAINTAIN ON public."User" TO cineverse_app', 'REVOKE MAINTAIN ON public."User" FROM cineverse_app'],
      ['history column SELECT', 'GRANT SELECT(id) ON public._prisma_migrations TO cineverse_app', 'REVOKE SELECT(id) ON public._prisma_migrations FROM cineverse_app'],
      ['direct TEMP', 'GRANT TEMP ON DATABASE cineverse_prod TO cineverse_app', 'REVOKE TEMP ON DATABASE cineverse_prod FROM cineverse_app'],
      ['schema grant option', 'GRANT USAGE ON SCHEMA public TO cineverse_app WITH GRANT OPTION', 'REVOKE GRANT OPTION FOR USAGE ON SCHEMA public FROM cineverse_app'],
    ]) await t.test(`Managed V1 rejects native ${name}`, () => denied(sql, undo))
    for (const security of ['DEFINER','INVOKER']) await t.test(`Managed V1 rejects executable SECURITY ${security} in pgx`, () =>
      denied(`CREATE FUNCTION pgx.managed_routine() RETURNS integer LANGUAGE sql SECURITY ${security} AS $$ SELECT 1 $$`, 'DROP FUNCTION pgx.managed_routine()'))
    await t.test('migrator owns real Prisma history/tables; custom persistent types outside migrations are rejected', async () => {
      await migrator.query("CREATE TYPE public.managed_type AS ENUM ('synthetic')")
      try { await assert.rejects(authorize('cineverse_migrator')) }
      finally { await migrator.query('DROP TYPE public.managed_type') }
      await authorize('cineverse_migrator')
    })
    await t.test('provider PUBLIC USAGE/TEMP never waives pgx column grants or invoker routines', async () => {
      const provider = new Client({ ...f.config.driver, database: 'postgres' })
      try {
        await provider.connect()
        await provider.query('CREATE SCHEMA pgx; CREATE TABLE pgx.managed_extra(id int); GRANT SELECT(id) ON pgx.managed_extra TO cineverse_app')
        await assert.rejects(authorize())
        await provider.query('REVOKE SELECT(id) ON pgx.managed_extra FROM cineverse_app')
        await authorize()
        await provider.query('CREATE FUNCTION pgx.managed_routine() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$')
        await assert.rejects(authorize())
        await provider.query('DROP FUNCTION pgx.managed_routine()')
        await authorize()
        await provider.query('DROP SCHEMA pgx CASCADE')
      } finally { await provider.end() }
    })
    await t.test('actual Prisma SQL/services remain on persistent objects with poisoned temporary tables and connection reuse', async () => {
      await testPrismaShadowing(f, admin, migrator)
    })
  } finally {
    await admin.query('DROP SCHEMA IF EXISTS pgx CASCADE; DROP SCHEMA IF EXISTS pgworkspace CASCADE')
    await admin.query('REVOKE CONNECT, TEMP ON DATABASE cineverse_prod FROM PUBLIC; REVOKE USAGE ON SCHEMA public FROM PUBLIC')
    await f.admin.query('REVOKE CONNECT, TEMP ON DATABASE postgres, template1 FROM PUBLIC')
    await f.admin.query('ALTER DATABASE postgres OWNER TO cineverse_ci_bootstrap; ALTER DATABASE template1 OWNER TO cineverse_ci_bootstrap')
    await f.admin.query('GRANT CREATE ON DATABASE cineverse_ci TO cineverse_migrator')
  }
}

async function testPrismaShadowing(f, admin, migrator) {
  const statements = []
  const pool = new Pool({ ...f.config.runtime.driver, database: 'cineverse_prod', options: safePath, max: 1 })
  pool.on('connect', client => {
    const query = client.query
    client.query = function (...args) {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text
      if (sql) statements.push(sql)
      return query.apply(this, args)
    }
  })
  const orm = await createDatabaseClient({ production: false, driver: pool })
  try {
    const lease = await pool.connect()
    const pid = (await lease.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    try {
      for (const name of ['User','Session','PasswordResetToken','Favorite'])
        await lease.query(`CREATE TEMP TABLE "${name}" (LIKE public."${name}" INCLUDING ALL)`)
      // Runtime correctly lacks SELECT even to use LIKE on the real history table.
      await lease.query('CREATE TEMP TABLE _prisma_migrations(id text)')
      // A deliberately hostile session setting proves qualification, not merely a default path.
      await lease.query('SET search_path=pg_temp,public,pg_catalog')
    } finally { lease.release() }
    const businessStart = statements.length
    const password = 'Synthetic managed password 123!', next = 'Synthetic managed password 456!'
    const hash = await hashRegistrationPassword(password)
    const user = await orm.user.create({ data: { name: 'Managed fixture', email: randomBytes(8).toString('hex') + '@fixture.test', passwordHash: hash } })
    const sessions = createSessionService({ getClient: async () => orm, config: readAuthConfig({}) })
    const token = await sessions.create(user.id, hash)
    await orm.favorite.create({ data: { userId: user.id, movieId: 27205 } })
    await createProfileService({ getClient: async () => orm }).update(user.id, token, 'Managed updated')
    await createChangePasswordService({ getClient: async () => orm })(user.id, token, { currentPassword: password, newPassword: next })
    assert.equal(await orm.session.count({ where: { userId: user.id } }), 0)
    let resetToken
    const recovery = createPasswordResetService({ getClient: async () => orm, minimumDurationMs: 0,
      delivery: { ready: () => 'https://fixture.invalid', send: async ({ resetUrl }) => { resetToken = new URL(resetUrl).hash.slice('#token='.length) } } })
    await recovery.forgot({ email: user.email })
    await recovery.reset({ token: resetToken, password, confirmPassword: password })
    const businessStatements = statements.slice(businessStart)
    assert.ok(businessStatements.length > 0)
    assert.ok(businessStatements.every(sql => !/(?:FROM|INTO|UPDATE|JOIN)\s+"(?:User|Session|Favorite|PasswordResetToken)"/i.test(sql)),
      'Every captured business statement must avoid unqualified application table references')
    const { rows: [stored] } = await admin.query('SELECT name FROM public."User" WHERE id=$1', [user.id])
    assert.equal(stored.name, 'Managed updated')
    const lease2 = await pool.connect()
    try {
      assert.equal((await lease2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid)
      for (const name of ['User','Session','PasswordResetToken','Favorite','_prisma_migrations'])
        assert.equal((await lease2.query(`SELECT count(*)::int AS count FROM pg_temp."${name}"`)).rows[0].count, 0)
      await assert.rejects(lease2.query('SELECT * FROM public._prisma_migrations'), error => error.code === '42501')
      await lease2.query('SET search_path=pg_catalog,public,pg_temp')
    } finally { lease2.release() }
    for (const name of ['User','Session','PasswordResetToken','Favorite']) {
      const references = businessStatements.filter(sql => new RegExp(`(?:FROM|INTO|UPDATE|JOIN)\\s+[^;]*?"${name}"`, 'i').test(sql))
      assert.ok(references.some(sql => sql.includes(`"public"."${name}"`)), 'Actual Prisma SQL must name public.' + name)
    }
    await migrator.query('CREATE TEMP TABLE _prisma_migrations (LIKE public._prisma_migrations INCLUDING ALL)')
    try {
      await migrator.query('SET search_path=pg_temp,public,pg_catalog')
      const snapshot = await inspectProductionMigration(adapter(migrator))
      assert.equal(snapshot.migrations.length, 4, 'History query must bypass empty temporary history')
    } finally {
      await migrator.query('DROP TABLE pg_temp._prisma_migrations; SET search_path=pg_catalog,public,pg_temp')
    }
    await orm.user.delete({ where: { id: user.id } })
  } finally { await orm.$disconnect(); await pool.end() }
}
