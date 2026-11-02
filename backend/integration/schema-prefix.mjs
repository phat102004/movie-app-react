// This helper is called only by the marker/port/empty-cluster-guarded native
// fixture. All DDL below belongs to that disposable cluster, never Neon/local DB.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { inspectRoleSecurity, validateProductionRole } from '../database/role-security.mjs'
import { inspectDatabase } from '../database/inspect.mjs'
import { inspectProductionMigration } from '../database/production-migration-plan.mjs'
import { probeProviderDatabase, validateProviderProbe } from '../database/provider-connect.mjs'
import { knownMigrations } from '../database/inspect.mjs'

const adapter = client => ({ $queryRaw: async (strings, ...values) => {
  assert.equal(values.length, 0)
  return (await client.query(strings.join(''))).rows
} })

async function exercisePrefixPrivileges(t, admin, inspect, validate) {
  await admin.query('CREATE SCHEMA pgx; CREATE SCHEMA pgworkspace')
  await t.test('literal namespace scope includes pgx/pgworkspace/public, excludes pg_catalog/pg_toast/information_schema', async () => {
    const value = await inspect(), state = value.snapshot ?? value
    const names = state.schemas.map(row => row.name)
    for (const name of ['pgx', 'pgworkspace', 'public']) assert.ok(names.includes(name), name)
    for (const name of ['pg_catalog', 'pg_toast', 'information_schema']) assert.ok(!names.includes(name), name)
    validate(value)
  })
  await t.test('real pgx schema ownership is inspected and rejected', async () => {
    await admin.query('ALTER SCHEMA pgx OWNER TO cineverse_app')
    try {
      const value = await inspect(), state = value.snapshot ?? value
      assert.throws(() => validate(value))
      assert.equal(state.schemas.find(row => row.name === 'pgx')?.owner, true)
    } finally { await admin.query('ALTER SCHEMA pgx OWNER TO cineverse_ci_bootstrap') }
  })
  for (const [name, privilege, key] of [['pgx', 'CREATE', 'create'], ['pgworkspace', 'USAGE', 'usage']]) {
    await t.test(`real ${name} schema ${privilege} is inspected and rejected`, async () => {
      // Values are a fixed fixture allowlist, never user input.
      await admin.query(`GRANT ${privilege} ON SCHEMA ${name} TO cineverse_app`)
      try {
        const value = await inspect(), state = value.snapshot ?? value
        assert.throws(() => validate(value))
        assert.equal(state.schemas.find(row => row.name === name)?.[key], true)
      } finally { await admin.query(`REVOKE ${privilege} ON SCHEMA ${name} FROM cineverse_app`) }
    })
  }
  await t.test('pgx table and column SELECT grants cannot disappear from inspection', async () => {
    await admin.query('CREATE TABLE pgx.prefix_data(id integer, private_note text)')
    for (const privilege of ['SELECT (id)', 'SELECT']) {
      await admin.query(`GRANT ${privilege} ON TABLE pgx.prefix_data TO cineverse_app`)
      try {
        const value = await inspect(), state = value.snapshot ?? value
        const table = state.tables.find(row => row.schema === 'pgx' && row.name === 'prefix_data')
        assert.throws(() => validate(value))
        assert.equal(table?.columnAccess, true)
        assert.equal(table.select, privilege === 'SELECT')
      } finally { await admin.query(`REVOKE ${privilege} ON TABLE pgx.prefix_data FROM cineverse_app`) }
    }
  })
  await t.test('pgworkspace sequence USAGE is inspected and rejected', async () => {
    await admin.query('CREATE SEQUENCE pgworkspace.prefix_sequence')
    await admin.query('GRANT USAGE ON SEQUENCE pgworkspace.prefix_sequence TO cineverse_app')
    try {
      const value = await inspect(), state = value.snapshot ?? value
      assert.throws(() => validate(value))
      assert.ok(state.sequences.some(row => row.usage))
    } finally { await admin.query('REVOKE USAGE ON SEQUENCE pgworkspace.prefix_sequence FROM cineverse_app') }
  })
  await t.test('pgworkspace executable SECURITY DEFINER routine is inspected and rejected', async () => {
    await admin.query('CREATE FUNCTION pgworkspace.prefix_guard() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$')
    try {
      const value = await inspect(), state = value.snapshot ?? value
      assert.throws(() => validate(value))
      assert.equal(state.identity.unsafeRoutines, true)
    } finally { await admin.query('REVOKE EXECUTE ON FUNCTION pgworkspace.prefix_guard() FROM PUBLIC') }
  })
  validate(await inspect()) // No leftover fixture grants can mask a later check.
}

export async function testStrictSchemaPrefix(t, f) {
  // Create a fresh production-NAMED database inside the proven private cluster so
  // the real identity predicate passes. No normalization/mocking of the snapshot.
  await f.admin.query('CREATE DATABASE cineverse_prod')
  await f.admin.query('REVOKE CONNECT, TEMP ON DATABASE cineverse_prod FROM PUBLIC')
  await f.admin.query('GRANT CONNECT ON DATABASE cineverse_prod TO cineverse_app, cineverse_migrator')
  await f.admin.query('GRANT CREATE ON DATABASE cineverse_prod TO cineverse_migrator')
  const admin = new Client({ ...f.config.driver, database: 'cineverse_prod' })
  const migrator = new Client({ ...f.config.migration.driver, database: 'cineverse_prod' })
  const runtime = new Client({ ...f.config.runtime.driver, database: 'cineverse_prod' })
  try {
    await admin.connect()
    await admin.query('REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC')
    await admin.query('GRANT USAGE, CREATE ON SCHEMA public TO cineverse_migrator')
    await admin.query('GRANT USAGE ON SCHEMA public TO cineverse_app')
    await migrator.connect()
    await migrator.query('SET search_path = public') // Same schema as Prisma CLI.
    for (const name of knownMigrations)
      await migrator.query(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
    // Minimal empty history for ACL/inventory tests; the existing cineverse_ci
    // suite separately tests real Prisma deploy/history/checksums and drift.
    await migrator.query(`CREATE TABLE public._prisma_migrations (
      id text PRIMARY KEY, migration_name text, checksum text, finished_at timestamptz,
      rolled_back_at timestamptz, started_at timestamptz DEFAULT now())`)
    const grants = await readFile(new URL('../database/production-runtime-grants.sql', import.meta.url), 'utf8')
    await admin.query(grants.split('-- RUNTIME_GRANTS_BEGIN')[1].split('-- RUNTIME_GRANTS_END')[0])
    await f.admin.query('REVOKE CONNECT ON DATABASE cineverse_ci FROM cineverse_app, cineverse_migrator')
    await runtime.connect()
    const inspect = () => inspectRoleSecurity(adapter(runtime))
    const initial = await inspect()
    assert.equal(initial.identity.database, 'cineverse_prod')
    assert.equal(initial.identity.otherDatabaseConnect, false)
    validateProductionRole(initial, 'runtime') // Positive, genuine strict baseline.
    await exercisePrefixPrivileges(t, admin, inspect, value => validateProductionRole(value, 'runtime'))
    await t.test('production migration inventory sees relations in both pgx and pgworkspace', async () => {
      const inventory = await inspectProductionMigration(adapter(migrator))
      for (const name of ['pgx', 'pgworkspace']) assert.ok(inventory.objects.some(row => row.schema === name))
      assert.ok(!inventory.objects.some(row => ['pg_catalog', 'pg_toast', 'information_schema'].includes(row.schema)))
    })
    await t.test('local inspector also sees pgx/pgworkspace on a fresh private cineverse_dev', async () => {
      await f.admin.query('CREATE DATABASE cineverse_dev')
      await f.admin.query('REVOKE CONNECT, TEMP ON DATABASE cineverse_dev FROM PUBLIC')
      const local = new Client({ ...f.config.driver, database: 'cineverse_dev' })
      try {
        await local.connect()
        await local.query('CREATE SCHEMA pgx; CREATE TABLE pgx.prefix_fixture(id int); CREATE SCHEMA pgworkspace; CREATE SEQUENCE pgworkspace.prefix_fixture')
        const inventory = await inspectDatabase(adapter(local))
        assert.deepEqual(inventory.objects.map(row => row.schema), ['pgworkspace', 'pgx'])
      } finally { await local.end() }
    })
  } finally {
    await Promise.allSettled([runtime.end(), migrator.end(), admin.end()])
    await f.admin.query('GRANT CONNECT ON DATABASE cineverse_ci TO cineverse_app, cineverse_migrator')
    await f.admin.query('REVOKE CONNECT ON DATABASE cineverse_prod FROM cineverse_app, cineverse_migrator')
  }
}

export async function testProviderSchemaPrefix(t, f, expected) {
  const admin = new Client({ ...f.config.driver, database: expected.name })
  const inspect = () => probeProviderDatabase(f.config.runtime, expected, inspectRoleSecurity)
  const validate = value => validateProviderProbe(value, expected, 'cineverse_app')
  try {
    await admin.connect()
    await exercisePrefixPrivileges(t, admin, inspect, validate)
    await t.test('provider pgx SECURITY INVOKER routine and MAINTAIN are rejected by supplemental queries', async () => {
      await admin.query('CREATE FUNCTION pgx.prefix_invoker() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$')
      try {
        const value = await inspect()
        assert.equal(value.snapshot.identity.unsafeRoutines, false)
        assert.equal(value.accessibleRoutines, true)
        assert.throws(() => validate(value))
      } finally { await admin.query('REVOKE EXECUTE ON FUNCTION pgx.prefix_invoker() FROM PUBLIC') }
      await admin.query('GRANT MAINTAIN ON TABLE pgx.prefix_data TO cineverse_app')
      try {
        const value = await inspect()
        assert.equal(value.maintenance, true)
        assert.throws(() => validate(value))
      } finally { await admin.query('REVOKE MAINTAIN ON TABLE pgx.prefix_data FROM cineverse_app') }
    })
    validate(await inspect())
  } finally { await admin.end() }
}
