import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDatabaseSecurityPolicy, validateNeonEvidence } from '../database/provider-policy.mjs'
import { validateProviderInventory, validateProviderProbe, verifyProviderConnect } from '../database/provider-connect.mjs'
import { validateManagedPrivileges } from '../database/managed-privileges.mjs'
import { applicationTables, validateProductionRole } from '../database/role-security.mjs'
import { readRuntimeDatabaseConfig, readMigrationDatabaseConfig } from '../database/connection-config.mjs'

const host = 'ep-synthetic.region.aws.neon.tech'
function profile() {
  return validateNeonEvidence({ version: 2, contract: 'managed-postgresql-v1', provider: 'neon', host,
    endpointId: 'ep-synthetic', projectId: 'synthetic-project', branchId: 'br-synthetic', reviewRef: 'synthetic-review',
    reviewedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    target: { name: 'cineverse_prod', oid: 100, owner: 'application_owner', ownerOid: 10, publicTemporary: true, publicSchemaUsage: true },
    systemDatabases: [ { name: 'postgres', oid: 5, owner: 'provider_owner', ownerOid: 20, isTemplate: false, publicTemporary: true, publicSchemaUsage: true },
      { name: 'template1', oid: 1, owner: 'provider_owner', ownerOid: 20, isTemplate: true, publicTemporary: false, publicSchemaUsage: true } ],
  }, host)
}
function rows(policy) {
  return [policy.target, ...policy.systemDatabases].map(row => ({ isTemplate: false, ...row, isOwner: false,
    allowConnections: true, connect: true, publicConnect: true, directConnect: false, connectGrantOption: false,
    create: false, publicCreate: false, createGrantOption: false, temp: row.publicTemporary,
    directTemporary: false, tempGrantOption: false }))
}
function state(expected, role = 'cineverse_app') {
  const target = expected.name === 'cineverse_prod', migration = target && role === 'cineverse_migrator'
  return { identity: { database: expected.name, role, sessionRole: role, canLogin: true, superuser: false,
    createDb: false, createRole: false, replication: false, bypassRls: false, inherit: false, memberships: 0,
    dbOwner: false, dbConnect: true, dbCreate: migration, dbTemp: expected.publicTemporary,
    ownsObjects: migration, unsafeRoutines: false, otherDatabaseConnect: true },
  schemas: [{ name: 'public', owner: false, usage: true, create: migration }],
  tables: target ? [...applicationTables, '_prisma_migrations'].map(name => ({ schema: 'public', name, kind: 'r', owner: migration,
    ...Object.fromEntries(['select','insert','update','delete','columnAccess'].map(key => [key, migration || name !== '_prisma_migrations'])),
    ...Object.fromEntries(['truncate','references','trigger','grantOption','columnGrantOption'].map(key => [key, migration])) })) : [],
  sequences: [], managed: { path: target ? 'pg_catalog, public, pg_temp' : 'pg_catalog,pg_temp',
    publicSchemaUsage: true, publicSchemaCreate: false, schemaGrantOption: false, schemaCreateGrantOption: false,
    routines: false, ownedCustomTypes: false, maintenance: [] } }
}
const conf = policy => ({ providerPolicy: policy, driver: { host, port: 5432, database: 'cineverse_prod',
  user: 'cineverse_app', ssl: { rejectUnauthorized: true, servername: host } } })
const probe = (expected, policy) => ({ database: rows(policy).find(row => row.name === expected.name),
  snapshot: state(expected), accessibleRoutines: false, maintenance: false })

test('Managed V1 requires a separate explicit production mode and versioned operator profile; strict remains default', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cineverse-managed-unit-')), file = join(dir, 'synthetic.json')
  t.after(() => { rmSync(file); rmdirSync(dir) })
  const value = profile(); writeFileSync(file, JSON.stringify(value))
  const env = { NODE_ENV: 'production', DATABASE_SECURITY_POLICY: 'neon-managed-v1', DATABASE_PROVIDER_EVIDENCE_FILE: file }
  assert.equal(readDatabaseSecurityPolicy({}, host), undefined)
  assert.equal(readDatabaseSecurityPolicy(env, host).contract, 'managed-postgresql-v1')
  for (const change of [{ NODE_ENV: 'test' }, { DATABASE_SECURITY_POLICY: 'strict' },
    { DATABASE_SECURITY_POLICY: 'neon-reviewed-system-connect' }, { DATABASE_PROVIDER_EVIDENCE_FILE: '' }])
    assert.throws(() => readDatabaseSecurityPolicy({ ...env, ...change }, host))
  const legacy = structuredClone(value); legacy.version = 1; delete legacy.contract
  for (const row of [legacy.target, ...legacy.systemDatabases]) { delete row.publicTemporary; delete row.publicSchemaUsage }
  writeFileSync(file, JSON.stringify(legacy))
  assert.throws(() => readDatabaseSecurityPolicy(env, host))
})

test('Managed profile rejects missing/default-coerced flags, unknown contract, tampering and expiry', () => {
  for (const change of [p => { delete p.target.publicTemporary }, p => { p.target.publicTemporary = 'true' },
    p => { p.target.publicSchemaUsage = false }, p => { p.contract = 'managed-postgresql-v2' },
    p => { p.systemDatabases[0].oid++ }, p => { p.host = 'ep-other.region.aws.neon.tech' },
    p => { p.expiresAt = new Date(Date.now() - 1).toISOString() }]) {
    const p = structuredClone(profile()); change(p)
    if (p.systemDatabases[0].oid === 6) {
      const current = rows(profile()); assert.throws(() => validateProviderInventory(current, validateNeonEvidence(p, host)))
    } else assert.throws(() => validateNeonEvidence(p, host))
  }
})

test('Managed V1 requires direct Neon URLs for runtime and migration; matching pooled profiles and proxy options fail closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cineverse-managed-direct-')), file = join(dir, 'synthetic.json')
  t.after(() => { rmSync(file); rmdirSync(dir) })
  function env(p) {
    writeFileSync(file, JSON.stringify(p))
    const uri = role => `postgresql://${role}:synthetic-direct-password@${p.host}:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict`
    return { NODE_ENV: 'production', PRODUCTION_DATABASE_HOST: p.host,
      DATABASE_SECURITY_POLICY: 'neon-managed-v1', DATABASE_PROVIDER_EVIDENCE_FILE: file,
      DATABASE_URL: uri('cineverse_app'), MIGRATION_DATABASE_URL: uri('cineverse_migrator') }
  }
  for (const read of [readRuntimeDatabaseConfig, readMigrationDatabaseConfig]) {
    const p = profile()
    assert.equal(read(env(p)).providerPolicy.contract, 'managed-postgresql-v1')
    const pooled = structuredClone(p)
    pooled.endpointId += '-pooler'; pooled.host = pooled.host.replace('ep-synthetic.', 'ep-synthetic-pooler.')
    assert.throws(() => read(env(pooled)), 'Even matching profile/URL/host cannot opt into unsupported transaction pooling')
    for (const suffix of ['&pgbouncer=true', '&host=ep-synthetic-pooler.region.aws.neon.tech', '&options=-c%20search_path=pg_temp']) {
      const values = env(p)
      values.DATABASE_URL += suffix; values.MIGRATION_DATABASE_URL += suffix
      assert.throws(() => read(values))
    }
  }
})

test('Managed inventory admits only exact reviewed PUBLIC TEMP/CONNECT, never direct rights, grant options or unknown DBs', () => {
  const p = profile(); validateProviderInventory(rows(p), p)
  for (const change of [r => { r[0].directTemporary = true }, r => { r[1].directTemporary = true },
    r => { r[1].tempGrantOption = true }, r => { r[0].createGrantOption = true },
    r => { r[1].publicTemporary = false }, r => { r[2].temp = true }, r => { r[1].directConnect = true },
    r => { r[1].publicCreate = true }, r => { r.push({ ...r[1], oid: 900, name: 'unknown_application' }) }]) {
    const r = rows(p); change(r); assert.throws(() => validateProviderInventory(r, p))
  }
})

test('Managed privileges reject unsafe paths, schema grants, MAINTAIN, custom invoker/definer routines and types', () => {
  const p = profile(); validateManagedPrivileges(state(p.target), p.target, 'runtime')
  for (const change of [s => { s.managed.path = 'pg_catalog,public' }, s => { s.managed.routines = true },
    s => { s.managed.ownedCustomTypes = true }, s => { s.managed.publicSchemaCreate = true },
    s => { s.managed.schemaCreateGrantOption = true }, s => { s.managed.maintenance.push({ schema: 'public', name: 'User', maintain: true }) },
    s => { s.schemas.push({ name: 'pgx', owner: false, usage: true, create: false }) }]) {
    const s = state(p.target); change(s); assert.throws(() => validateManagedPrivileges(s, p.target, 'runtime'))
  }
})

test('PUBLIC USAGE does not waive provider object/column/sequence/routine checks or legacy policy', () => {
  const p = profile(), expected = p.systemDatabases[0], good = probe(expected, p)
  validateProviderProbe(good, expected, 'cineverse_app', p)
  assert.throws(() => validateProviderProbe(good, expected, 'cineverse_app'))
  for (const change of [v => { v.snapshot.tables.push({ columnAccess: true }) },
    v => { v.snapshot.sequences.push({ usage: true }) }, v => { v.snapshot.managed.routines = true },
    v => { v.snapshot.identity.memberships = 1 }, v => { v.snapshot.schemas[0].create = true }]) {
    const v = structuredClone(good); change(v); assert.throws(() => validateProviderProbe(v, expected, 'cineverse_app', p))
  }
})

test('Managed TEMP never bypasses base predicates or proof; failed recheck revokes approval', async () => {
  const p = profile(), s = state(p.target), config = conf(p), client = { $queryRaw: async () => rows(p) }
  assert.throws(() => validateProductionRole(s, 'runtime', p))
  assert.throws(() => validateProductionRole(s, 'runtime'))
  await verifyProviderConnect(client, config, s, async () => s, async (_, expected) => probe(expected, p))
  validateProductionRole(s, 'runtime', p)
  for (const key of ['dbOwner','superuser','bypassRls']) {
    s.identity[key] = true; assert.throws(() => validateProductionRole(s, 'runtime', p)); s.identity[key] = false
  }
  await assert.rejects(verifyProviderConnect(client, config, s, async () => s, async () => { throw Error('synthetic failure') }))
  assert.throws(() => validateProductionRole(s, 'runtime', p))
})

test('Managed profile/snapshot mutation, expiry during probes and older late success cannot create approval', async t => {
  const p = structuredClone(profile()), s = state(p.target), config = conf(p), client = { $queryRaw: async () => rows(p) }
  await verifyProviderConnect(client, config, s, async () => s, async (_, expected) => probe(expected, p))
  p.reviewRef = 'synthetic-changed-review'
  assert.throws(() => validateProductionRole(s, 'runtime', p), 'Approval is bound to profile content, not just object identity')
  let release, entered
  const hold = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const old = verifyProviderConnect(client, config, s, async () => s, async (_, expected) => { entered(); await hold; return probe(expected, p) })
  const deniedOld = assert.rejects(old)
  await started
  await assert.rejects(verifyProviderConnect(client, config, s, async () => s, async () => { throw Error('synthetic newer denial') }))
  release(); await deniedOld
  assert.throws(() => validateProductionRole(s, 'runtime', p))
  await assert.rejects(verifyProviderConnect(client, config, s, async () => s, async (_, expected) => {
    t.mock.method(Date, 'now', () => Date.parse(p.expiresAt) + 1)
    return probe(expected, p)
  }))
  t.mock.restoreAll()
  assert.throws(() => validateProductionRole(s, 'runtime', p))
})
