import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { readRuntimeDatabaseConfig } from '../database/connection-config.mjs'
import { readDatabaseSecurityPolicy, validateNeonEvidence } from '../database/provider-policy.mjs'
import { validateProductionRole, applicationTables, assertProductionRole } from '../database/role-security.mjs'
import { validateProviderInventory, validateProviderProbe, verifyProviderConnect, probeProviderDatabase } from '../database/provider-connect.mjs'

const clone = value => structuredClone(value)
const host = 'ep-synthetic.region.aws.neon.tech'
function evidence() {
  return { version: 1, provider: 'neon', host, projectId: 'synthetic-project', branchId: 'br-synthetic',
    endpointId: 'ep-synthetic', reviewRef: 'synthetic-review', reviewedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    target: { name: 'cineverse_prod', oid: 16000, owner: 'cineverse_prod_owner', ownerOid: 100 },
    systemDatabases: [{ name: 'postgres', oid: 5, owner: 'cloud_admin', ownerOid: 10, isTemplate: false },
      { name: 'template1', oid: 1, owner: 'cloud_admin', ownerOid: 10, isTemplate: true }] }
}
function inventory(policy) {
  return [policy.target, ...policy.systemDatabases].map(row => ({ isTemplate: false, ...row, allowConnections: true,
    isOwner: false, connect: true, publicConnect: row.name !== 'cineverse_prod', directConnect: row.name === 'cineverse_prod',
    connectGrantOption: false, create: false, temp: false }))
}
function snapshot(role = 'cineverse_app', database = 'cineverse_prod') {
  const runtime = role === 'cineverse_app'
  return { identity: { database, role, sessionRole: role, canLogin: true, superuser: false, createDb: false,
    createRole: false, replication: false, bypassRls: false, inherit: false, memberships: 0,
    dbOwner: false, dbConnect: true, dbTemp: false, dbCreate: !runtime && database === 'cineverse_prod',
    otherDatabaseConnect: true, ownsObjects: !runtime && database === 'cineverse_prod', unsafeRoutines: false },
    schemas: database === 'cineverse_prod' ? [{ name: 'public', usage: true, create: !runtime, owner: false }] : [],
    tables: database === 'cineverse_prod' ? [...applicationTables, '_prisma_migrations'].map(name => ({ name, schema: 'public', kind: 'r', owner: !runtime,
      ...Object.fromEntries(['select', 'insert', 'update', 'delete', 'columnAccess'].map(key => [key, !runtime || name !== '_prisma_migrations'])),
      ...Object.fromEntries(['truncate', 'references', 'trigger', 'grantOption', 'columnGrantOption'].map(key => [key, !runtime])) })) : [], sequences: [] }
}
const config = policy => ({ providerPolicy: policy, driver: { host, port: 5432, database: 'cineverse_prod', user: 'cineverse_app', ssl: { rejectUnauthorized: true, servername: host } } })
const probe = (expected, role = 'cineverse_app') => ({ database: { ...expected, allowConnections: true },
  snapshot: snapshot(role, expected.name), accessibleRoutines: false, maintenance: false })

test('Provider policy defaults strict; explicit mode requires production, bounded evidence file and pinned Neon identity', t => {
  assert.equal(readDatabaseSecurityPolicy({}, host), undefined)
  assert.equal(readDatabaseSecurityPolicy({ DATABASE_SECURITY_POLICY: 'strict' }, host), undefined)
  const dir = mkdtempSync(join(tmpdir(), 'cineverse-policy-')), file = join(dir, 'evidence.json')
  t.after(() => { unlinkSync(file); rmdirSync(dir) })
  writeFileSync(file, JSON.stringify(evidence()))
  const env = { NODE_ENV: 'production', DATABASE_SECURITY_POLICY: 'neon-reviewed-system-connect', DATABASE_PROVIDER_EVIDENCE_FILE: file }
  assert.equal(readDatabaseSecurityPolicy(env, host).provider, 'neon')
  for (const invalid of [{ ...env, NODE_ENV: 'test' }, { ...env, DATABASE_SECURITY_POLICY: 'all' },
    { ...env, DATABASE_SECURITY_POLICY: 'strict' }, { ...env, DATABASE_PROVIDER_EVIDENCE_FILE: 'relative.json' },
    { ...env, DATABASE_PROVIDER_EVIDENCE_FILE: '' }]) assert.throws(() => readDatabaseSecurityPolicy(invalid, host))
  writeFileSync(file, 'x'.repeat(8193)); assert.throws(() => readDatabaseSecurityPolicy(env, host))
})

test('Evidence rejects forged provider/endpoint, expired or excessive lifetime, extra fields and name-only exceptions', () => {
  const good = evidence()
  validateNeonEvidence(good, host)
  const changes = [value => { value.provider = 'other' }, value => { value.host = 'db.fixture.test' },
    value => { value.endpointId = 'ep-other' }, value => { value.branchId = '' },
    value => { value.expiresAt = new Date(Date.now() - 1).toISOString() },
    value => { value.expiresAt = new Date(Date.now() + 172800_000).toISOString() },
    value => { value.extra = true }, value => { delete value.systemDatabases[0].ownerOid },
    value => { value.systemDatabases[0].oid = value.target.oid },
    value => { value.systemDatabases[0].owner = 'cineverse_app' },
    value => { value.systemDatabases[0].name = 'another_application' },
    value => { value.systemDatabases[0].ownerOid = value.target.ownerOid }]
  for (const change of changes) { const input = clone(good); change(input); assert.throws(() => validateNeonEvidence(input, host)) }
})

test('Production connection guards remain strict for role, target, schema and TLS; local cannot enable compatibility', () => {
  const uri = 'postgresql://cineverse_app:synthetic-production-password@' + host + ':5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict'
  const env = { NODE_ENV: 'production', DATABASE_URL: uri, PRODUCTION_DATABASE_HOST: host }
  assert.equal(readRuntimeDatabaseConfig(env).providerPolicy, undefined)
  for (const url of [uri.replace('cineverse_app:', 'cineverse_prod_owner:'), uri.replace('cineverse_prod?', 'postgres?'),
    uri.replace('schema=public', 'schema=private'), uri.replace('sslmode=require', 'sslmode=disable')])
    assert.throws(() => readRuntimeDatabaseConfig({ ...env, DATABASE_URL: url }))
  assert.throws(() => readRuntimeDatabaseConfig({ NODE_ENV: 'test', DATABASE_SECURITY_POLICY: 'neon-reviewed-system-connect' }))
})

test('Startup guard stays strict by default and rejects privileged identities before any provider probe', async () => {
  for (const kind of ['strict', 'owner', 'membership']) {
    const state = snapshot()
    if (kind === 'owner') state.identity.role = 'cineverse_prod_owner'
    if (kind === 'membership') state.identity.memberships = 1
    const answers = [[state.identity], state.schemas, state.tables, state.sequences]
    let queries = 0
    await assert.rejects(assertProductionRole({ $queryRaw: async () => answers[queries++] }, {
      ...config(validateNeonEvidence(evidence(), host)), production: true, purpose: 'runtime',
      ...(kind === 'strict' ? { providerPolicy: undefined } : {}),
    }), /IDENTITY|ROLE_ATTRIBUTES_OR_MEMBERSHIP|DATABASE_PRIVILEGES/)
    assert.equal(queries, 4, 'No extra catalog/probe call is allowed after the role predicate fails')
  }
})

test('Inventory only permits evidenced PUBLIC CONNECT: spoofed name/OID/owner, direct grants, unknown DB, TEMP and CREATE fail', () => {
  const policy = validateNeonEvidence(evidence(), host), good = inventory(policy)
  assert.equal(validateProviderInventory(good, policy).length, 2)
  for (const change of [rows => { rows[1].oid++ }, rows => { rows[1].ownerOid++ },
    rows => { rows[1].owner = 'application_owner' }, rows => { rows[1].directConnect = true },
    rows => { rows[1].publicConnect = false }, rows => { rows[1].connectGrantOption = true },
    rows => { rows[1].temp = true }, rows => { rows[1].create = true },
    rows => { rows[1].isTemplate = true }, rows => { rows[1].isOwner = true },
    rows => { rows.push({ ...rows[1], oid: 18000, name: 'another_application' }) }]) {
    const rows = clone(good); change(rows); assert.throws(() => validateProviderInventory(rows, policy))
  }
  const rows = clone(good)
  rows.push({ ...rows[1], oid: 4, name: 'template0', allowConnections: false })
  assert.equal(validateProviderInventory(rows, policy).length, 2)
})

test('Cross-database probes reject schema USAGE, DDL, data/column grants, ownership, routines, membership and failed identity', () => {
  const expected = evidence().systemDatabases[0], good = probe(expected)
  validateProviderProbe(good, expected, 'cineverse_app')
  for (const change of [value => { value.snapshot.schemas.push({ name: 'public', usage: true, create: false, owner: false }) },
    value => { value.snapshot.identity.dbTemp = true }, value => { value.snapshot.identity.memberships = 1 },
    value => { value.snapshot.identity.role = 'cineverse_prod_owner' }, value => { value.database.oid++ },
    value => { value.accessibleRoutines = true }, value => { value.maintenance = true }, value => { value.snapshot.identity.ownsObjects = true },
    value => { value.snapshot.tables.push({ columnAccess: true }) }, value => { value.snapshot.sequences.push({ usage: true }) }]) {
    const input = clone(good); change(input); assert.throws(() => validateProviderProbe(input, expected, 'cineverse_app'))
  }
})

for (const role of ['cineverse_app', 'cineverse_migrator']) {
  test(`${role}: approval needs fresh probes, stays snapshot-bound and never waives other role/ACL predicates`, async () => {
    const policy = validateNeonEvidence(evidence(), host), rows = inventory(policy)
    const state = snapshot(role), purpose = role === 'cineverse_app' ? 'runtime' : 'migration'
    const conf = config(policy); conf.driver.user = role
    assert.throws(() => validateProductionRole(state, purpose))
    assert.throws(() => validateProductionRole(state, purpose, policy))
    let probes = 0
    await verifyProviderConnect({ $queryRaw: async () => rows }, conf, state, async () => state, async (_, expected) => {
      probes++; return probe(expected, role)
    })
    assert.equal(probes, 2)
    validateProductionRole(state, purpose, policy)
    assert.throws(() => validateProductionRole(state, purpose))
    assert.throws(() => validateProductionRole(clone(state), purpose, policy))
    for (const key of ['memberships', 'superuser', 'dbOwner']) {
      const previous = state.identity[key]; state.identity[key] = key === 'memberships' ? 1 : true
      assert.throws(() => validateProductionRole(state, purpose, policy)); state.identity[key] = previous
    }
    if (purpose === 'runtime') {
      state.tables[4].select = true
      assert.throws(() => validateProductionRole(state, purpose, policy))
    }
  })
}

test('Denied/failed probe, catalog drift and unverified TLS never grant approval', async () => {
  const policy = validateNeonEvidence(evidence(), host), conf = config(policy), state = snapshot()
  await assert.rejects(verifyProviderConnect({ $queryRaw: async () => inventory(policy) }, conf, state, async () => state, async () => { throw Error('synthetic private detail') }), error => !error.message.includes('synthetic private detail'))
  assert.throws(() => validateProductionRole(state, 'runtime', policy))
  let call = 0
  await assert.rejects(verifyProviderConnect({ $queryRaw: async () => {
    const rows = inventory(policy); if (call++) rows[1].create = true; return rows
  } }, conf, state, async () => state, async (_, expected) => probe(expected)))
  assert.throws(() => validateProductionRole(state, 'runtime', policy))
  conf.driver.ssl.rejectUnauthorized = false
  await assert.rejects(verifyProviderConnect({}, conf, state, async () => state))
})

test('A failed recheck revokes an earlier successful approval of the same snapshot immediately', async () => {
  const policy = validateNeonEvidence(evidence(), host), conf = config(policy), state = snapshot()
  const client = { $queryRaw: async () => inventory(policy) }
  await verifyProviderConnect(client, conf, state, async () => state, async (_, expected) => probe(expected))
  validateProductionRole(state, 'runtime', policy)
  await assert.rejects(verifyProviderConnect(client, conf, state, async () => state, async () => { throw Error('synthetic recheck failure') }))
  assert.throws(() => validateProductionRole(state, 'runtime', policy))
})

test('A slow earlier verification cannot restore approval after a newer failed recheck', async () => {
  const policy = validateNeonEvidence(evidence(), host), conf = config(policy), state = snapshot()
  const client = { $queryRaw: async () => inventory(policy) }
  let release, entered
  const hold = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const old = verifyProviderConnect(client, conf, state, async () => state, async (_, expected) => {
    entered(); await hold; return probe(expected)
  })
  // Attach rejection handling before releasing any asynchronous fixture work.
  const deniedOld = assert.rejects(old)
  await started
  await assert.rejects(verifyProviderConnect(client, conf, state, async () => state, async () => { throw Error('synthetic newer denial') }))
  release()
  await deniedOld
  assert.throws(() => validateProductionRole(state, 'runtime', policy))
})

test('Late target role/ACL response drift, expired evidence during probes and stale/mutated approvals fail closed', async t => {
  const now = Date.now(), input = evidence()
  input.expiresAt = new Date(now + 1000).toISOString()
  const policy = validateNeonEvidence(input, host), conf = config(policy), state = snapshot()
  const client = { $queryRaw: async () => inventory(policy) }
  await assert.rejects(verifyProviderConnect(client, conf, state, async () => {
    const newer = clone(state); newer.identity.memberships = 1; return newer
  }, async (_, expected) => probe(expected)))
  let advanced = false
  await assert.rejects(verifyProviderConnect(client, conf, state, async () => state, async (_, expected) => {
    if (!advanced) { t.mock.method(Date, 'now', () => now + 1001); advanced = true }
    return probe(expected)
  }))
  t.mock.restoreAll()
  const freshPolicy = validateNeonEvidence(evidence(), host), fresh = config(freshPolicy)
  await verifyProviderConnect({ $queryRaw: async () => inventory(freshPolicy) }, fresh, state, async () => state, async (_, expected) => probe(expected))
  state.identity.extra = true
  assert.throws(() => validateProductionRole(state, 'runtime', freshPolicy))
  delete state.identity.extra
  const approvedAt = performance.now()
  t.mock.method(performance, 'now', () => approvedAt + 6000)
  assert.throws(() => validateProductionRole(state, 'runtime', freshPolicy))
})

test('A real stalled TCP handshake times out, closes the direct probe and hides connection details', { timeout: 10000 }, async () => {
  const sockets = new Set()
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const conf = { driver: { host: '127.0.0.1', port: server.address().port,
      user: 'cineverse_app', password: 'synthetic-probe-password', database: 'synthetic' } }
    await assert.rejects(probeProviderDatabase(conf, evidence().systemDatabases[0], () => {
      throw Error('Inspector must not run before authentication')
    }), error => !/synthetic-probe-password|127\.0\.0\.1|postgresql:\/\//.test(error.message))
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  }
})
