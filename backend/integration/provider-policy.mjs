// Called only after nativeFixture has verified the opt-in, private cluster marker,
// version, port and empty inventory. No Neon connection or real role/DB is used.
import assert from 'node:assert/strict'
import { Client } from 'pg'
import { inspectRoleSecurity, validateProductionRole, validateCrossDatabaseConnect } from '../database/role-security.mjs'
import { inspectDatabaseInventory, validateProviderInventory, validateProviderProbe, probeProviderDatabase } from '../database/provider-connect.mjs'
import { nativeDatabase } from './config.mjs'
import { testProviderSchemaPrefix } from './schema-prefix.mjs'

export async function testNativeProviderPolicy(t, f) {
  // Synthetic provider owner has no LOGIN/password. These databases belong to
  // THIS disposable cluster, not to a managed provider or the developer server.
  await f.admin.query('CREATE ROLE synthetic_provider_owner NOLOGIN')
  await f.admin.query('ALTER DATABASE postgres OWNER TO synthetic_provider_owner')
  await f.admin.query('ALTER DATABASE template1 OWNER TO synthetic_provider_owner')
  await f.admin.query('GRANT CONNECT ON DATABASE postgres, template1 TO PUBLIC')
  const rows = await inspectDatabaseInventory(f.a)
  const policy = { target: rows.find(row => row.name === nativeDatabase),
    systemDatabases: ['postgres', 'template1'].map(name => rows.find(row => row.name === name)) }
  // Only the pure catalog/probe algorithm receives the isolated DB alias. The
  // real production config parser continues to require cineverse_prod + TLS.
  await t.test('strict rejects actual PUBLIC other-DB CONNECT; template0 datallowconn=false is excluded', async () => {
    for (const client of [f.a, f.migrator]) {
      const state = await inspectRoleSecurity(client)
      assert.equal(state.identity.otherDatabaseConnect, true)
      assert.throws(() => validateCrossDatabaseConnect(state), /DATABASE_PRIVILEGES/)
      assert.throws(() => validateProductionRole(state, client === f.a ? 'runtime' : 'migration'), /IDENTITY/)
    }
    assert.equal(rows.find(row => row.name === 'template0').allowConnections, false)
    assert.equal(validateProviderInventory(rows, policy).length, 2)
  })
  await t.test('CONNECT-only is insufficient: native default public schema USAGE fails the supplemental probe', async () => {
    const value = await probeProviderDatabase(f.config.runtime, policy.systemDatabases[0], inspectRoleSecurity)
    assert.ok(value.snapshot.schemas.some(row => row.usage))
    assert.throws(() => validateProviderProbe(value, policy.systemDatabases[0], 'cineverse_app'))
  })
  // Build a least-privilege synthetic scenario to test the positive algorithm.
  // This is NOT a deployment prescription: never change a Neon-managed schema.
  for (const database of ['postgres', 'template1']) {
    const admin = new Client({ ...f.config.driver, database })
    try {
      await admin.connect()
      await admin.query('REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC')
    } finally { await admin.end() }
  }
  await t.test('evidenced native OID/owner/template rows and fresh minimal-rights probes pass for both actual login roles', async () => {
    for (const [role, config] of [['cineverse_app', f.config.runtime], ['cineverse_migrator', f.config.migration]]) {
      for (const expected of policy.systemDatabases) {
        const value = await probeProviderDatabase(config, expected, inspectRoleSecurity)
        validateProviderProbe(value, expected, role)
      }
    }
  })
  await t.test('literal schema-prefix regression for fresh managed-provider probes', async st => {
    await testProviderSchemaPrefix(st, f, policy.systemDatabases[0])
  })
  await t.test('native read-only probe statement timeout fails closed and returns without waiting for a long query', async () => {
    await assert.rejects(probeProviderDatabase(f.config.runtime, policy.systemDatabases[0], async client => {
      await client.$queryRaw`SELECT pg_sleep(10)`
      throw Error('Synthetic slow query must be cancelled before inspection can succeed')
    }), error => !/pg_sleep|password|postgresql:\/\//.test(error.message))
  })
  await t.test('real user-created database, direct CONNECT and TEMP remain blocked; no name/owner/OID spoofing', async () => {
    await f.admin.query('CREATE DATABASE synthetic_other_application')
    // Defaults grant PUBLIC CONNECT: it must not become a third exception.
    let current = await inspectDatabaseInventory(f.a)
    assert.throws(() => validateProviderInventory(current, policy))
    await f.admin.query('REVOKE CONNECT ON DATABASE synthetic_other_application FROM PUBLIC')
    await f.admin.query('GRANT CONNECT ON DATABASE postgres TO cineverse_app')
    current = await inspectDatabaseInventory(f.a)
    assert.throws(() => validateProviderInventory(current, policy))
    await f.admin.query('REVOKE CONNECT ON DATABASE postgres FROM cineverse_app')
    await f.admin.query('GRANT TEMP ON DATABASE postgres TO PUBLIC')
    current = await inspectDatabaseInventory(f.a)
    assert.throws(() => validateProviderInventory(current, policy))
    await f.admin.query('REVOKE TEMP ON DATABASE postgres FROM PUBLIC')
    await f.admin.query('ALTER DATABASE postgres RENAME TO synthetic_original_postgres')
    await f.admin.query('ALTER DATABASE synthetic_other_application RENAME TO postgres')
    current = await inspectDatabaseInventory(f.a)
    assert.throws(() => validateProviderInventory(current, policy))
    await f.admin.query('ALTER DATABASE postgres RENAME TO synthetic_other_application')
    await f.admin.query('ALTER DATABASE synthetic_original_postgres RENAME TO postgres')
    assert.equal(validateProviderInventory(await inspectDatabaseInventory(f.a), policy).length, 2)
  })
  await t.test('neon_superuser membership rejected even with NOINHERIT; runtime DDL/history remain denied', async () => {
    await f.admin.query('CREATE ROLE neon_superuser NOLOGIN') // Synthetic, no provider exists in this cluster.
    await f.admin.query('GRANT neon_superuser TO cineverse_app')
    const value = await probeProviderDatabase(f.config.runtime, policy.systemDatabases[0], inspectRoleSecurity)
    assert.equal(value.snapshot.identity.memberships, 1)
    assert.throws(() => validateProviderProbe(value, policy.systemDatabases[0], 'cineverse_app'))
    await f.admin.query('REVOKE neon_superuser FROM cineverse_app')
    const client = await f.connection()
    for (const sql of ['CREATE TABLE public.synthetic_forbidden(id int)',
      'SELECT * FROM public._prisma_migrations',
      "INSERT INTO public._prisma_migrations(id) VALUES ('synthetic')",
      'UPDATE public._prisma_migrations SET checksum=checksum', 'DELETE FROM public._prisma_migrations'])
      await assert.rejects(client.query(sql), error => error.code === '42501')
  })
}
