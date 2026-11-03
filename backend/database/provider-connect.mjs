import { Client } from 'pg'
import { createHash } from 'node:crypto'
import { DatabaseConfigError } from './config.mjs'
import { validateNeonEvidence, isManagedV1 } from './provider-policy.mjs'
import { validateManagedPrivileges, validateManagedDatabase } from './managed-privileges.mjs'
import { withDeadline } from '../deadline.mjs'

const approvals = new WeakMap()
const generations = new WeakMap()
const fail = () => { throw new DatabaseConfigError('Managed database isolation chưa đạt: identity, CONNECT evidence hoặc quyền ngoài phạm vi chưa được xác nhận. Không tự GRANT/REVOKE; không log kết quả nội bộ.') }
const rights = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger',
  'grantOption', 'columnAccess', 'columnGrantOption']

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function hasVerifiedProviderConnect(snapshot, policy) {
  const approval = approvals.get(snapshot)
  const age = approval ? performance.now() - approval.at : -1
  return Boolean(policy && approval?.policy === policy && approval.policyDigest === digest(policy) && approval.digest === digest(snapshot) &&
    Date.parse(policy.expiresAt) > Date.now() && age >= 0 && age < 5000)
}

export async function inspectDatabaseInventory(client) {
  return client.$queryRaw`
    SELECT d.oid::int AS oid, d.datname::text AS name, d.datdba::int AS "ownerOid",
      pg_get_userbyid(d.datdba)::text AS owner, d.datistemplate AS "isTemplate",
      d.datallowconn AS "allowConnections", d.datdba = r.oid AS "isOwner",
      has_database_privilege(current_user, d.oid, 'CONNECT') AS connect,
      has_database_privilege(current_user, d.oid, 'CONNECT WITH GRANT OPTION') AS "connectGrantOption",
      has_database_privilege(current_user, d.oid, 'CREATE') AS create,
      has_database_privilege(current_user, d.oid, 'TEMP') AS temp,
      has_database_privilege(current_user, d.oid, 'TEMP WITH GRANT OPTION') AS "tempGrantOption",
      has_database_privilege(current_user, d.oid, 'CREATE WITH GRANT OPTION') AS "createGrantOption",
      EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'TEMPORARY') AS "publicTemporary",
      EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'CREATE') AS "publicCreate",
      EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
        WHERE a.grantee = r.oid AND a.privilege_type = 'TEMPORARY') AS "directTemporary",
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT') AS "publicConnect",
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
        WHERE a.grantee = r.oid AND a.privilege_type = 'CONNECT') AS "directConnect"
    FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_roles r
    WHERE r.rolname = current_user ORDER BY d.oid
  `
}

function sameDatabase(actual, expected) {
  return actual && ['name', 'oid', 'owner', 'ownerOid'].every(key => actual[key] === expected[key])
}

export function validateProviderInventory(rows, policy, purpose = 'runtime') {
  const managed = isManagedV1(policy)
  if (!Array.isArray(rows) || !rows.length || rows.length > 64 ||
    new Set(rows.map(row => row.oid)).size !== rows.length ||
    new Set(rows.map(row => row.name)).size !== rows.length || rows.some(row => row.isOwner !== false ||
      ['allowConnections', 'connect', 'publicConnect', 'directConnect', 'connectGrantOption', 'create', 'temp']
        .some(key => typeof row[key] !== 'boolean'))) fail()
  const target = rows.find(row => row.name === policy.target.name)
  if (!sameDatabase(target, policy.target) || target.allowConnections !== true || target.isTemplate !== false) fail()
  if (managed) validateManagedDatabase(target, policy.target, purpose)
  for (const expected of policy.systemDatabases) {
    const row = rows.find(row => row.name === expected.name)
    if (!sameDatabase(row, expected) || row.isTemplate !== expected.isTemplate ||
      typeof row.allowConnections !== 'boolean') fail()
    if (managed && (row.allowConnections !== true || row.connect !== true)) fail()
  }
  const candidates = rows.filter(row => row.name !== policy.target.name && row.allowConnections && row.connect)
  for (const row of candidates) {
    if (!policy.systemDatabases.some(expected => sameDatabase(row, expected)) ||
      row.publicConnect !== true || row.directConnect !== false ||
      row.connectGrantOption !== false || row.create !== false || (!managed && row.temp !== false)) fail()
    if (managed) validateManagedDatabase(row, policy.systemDatabases.find(expected => sameDatabase(row, expected)))
  }
  if (managed && rows.some(row => row !== target && !policy.systemDatabases.some(expected => sameDatabase(row, expected)) &&
    (row.create !== false || row.temp !== false))) fail()
  return candidates
}

export function validateProviderProbe(probe, expected, role, policy) {
  const managed = isManagedV1(policy)
  const id = probe?.snapshot?.identity
  if (!sameDatabase(probe?.database, expected) || probe.database.isTemplate !== expected.isTemplate ||
    probe.database.allowConnections !== true || !id || id.database !== expected.name ||
    id.role !== role || id.sessionRole !== role || id.canLogin !== true ||
    ['superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'inherit', 'dbOwner',
      'dbCreate', 'ownsObjects', 'unsafeRoutines', ...(!managed ? ['dbTemp'] : [])].some(key => id[key] !== false) ||
    id.dbConnect !== true || id.memberships !== 0 || probe.accessibleRoutines !== false || probe.maintenance !== false ||
    probe.snapshot.schemas.some(row => row.owner !== false || row.create !== false ||
      row.usage !== Boolean(managed && row.name === 'public' && expected.publicSchemaUsage)) ||
    probe.snapshot.tables.some(row => rights.some(key => row[key] !== false) || row.owner !== false) ||
    probe.snapshot.sequences.some(row => ['usage', 'select', 'update', 'owner'].some(key => row[key] !== false))) fail()
  if (managed) {
    if (id.dbTemp !== expected.publicTemporary) fail()
    validateManagedDatabase(probe.database, expected)
    validateManagedPrivileges(probe.snapshot, expected)
  }
}

// Two fixed system names from validated evidence only; never a URL/database from
// an HTTP request. Same credential, pinned endpoint and strict TLS as the caller.
export async function probeProviderDatabase(config, expected, inspectRole) {
  const client = new Client({ ...config.driver, database: expected.name,
    options: '-c search_path=pg_catalog,pg_temp -c default_transaction_read_only=on',
    connectionTimeoutMillis: 1500, statement_timeout: 1000, query_timeout: 1500 })
  function close() {
    const ended = client.end().catch(() => {})
    // A metadata-only READ ONLY probe has no work to commit. Destroy the pinned
    // pg transport too: cleanup must not wait for an unresponsive peer's FIN.
    client.connection?.stream?.destroy()
    return ended
  }
  try {
    return await withDeadline(async () => {
      await client.connect()
      await client.query('BEGIN READ ONLY')
      const adapter = { $queryRaw: async (strings, ...values) => {
        if (values.length) fail()
        return (await client.query(strings.join(''))).rows
      } }
      const inventory = await inspectDatabaseInventory(adapter)
      const snapshot = await inspectRole(adapter)
      const { rows: [routine] } = await client.query(`SELECT EXISTS(
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
          AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS accessible,
        EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
            AND c.relkind IN ('r','p','m') AND has_table_privilege(current_user, c.oid, 'MAINTAIN')) AS maintenance`)
      return { database: inventory.find(row => row.name === expected.name), snapshot,
        accessibleRoutines: routine.accessible, maintenance: routine.maintenance }
    }, 4000, () => { void close() })
  } catch { fail() } finally { await close() }
}

async function verifyConnect(client, config, snapshot, inspectRole, probe) {
  const policy = config.providerPolicy
  const policyDigest = digest(policy)
  validateNeonEvidence(policy, config.driver.host)
  if (config.driver.ssl?.rejectUnauthorized !== true || config.driver.ssl.servername !== policy.host ||
    config.driver.port !== 5432 || config.driver.database !== 'cineverse_prod' ||
    !['cineverse_app', 'cineverse_migrator'].includes(config.driver.user) ||
    snapshot.identity.role !== config.driver.user || snapshot.identity.sessionRole !== config.driver.user) fail()
  const rows = await inspectDatabaseInventory(client)
  const purpose = config.driver.user === 'cineverse_app' ? 'runtime' : 'migration'
  const candidates = validateProviderInventory(rows, policy, purpose)
  if (isManagedV1(policy)) validateManagedPrivileges(snapshot, policy.target, purpose)
  if (snapshot.identity.otherDatabaseConnect !== (candidates.length > 0)) fail()
  for (const row of candidates) {
    const expected = policy.systemDatabases.find(item => item.name === row.name)
    validateProviderProbe(await probe(config, expected, inspectRole), expected, config.driver.user, policy)
  }
  // Catch catalog/ACL drift during probes. This does not claim an atomic lock on
  // provider DDL; trusted-admin changes after startup remain a documented risk.
  if (JSON.stringify(await inspectDatabaseInventory(client)) !== JSON.stringify(rows) ||
    JSON.stringify(await inspectRole(client)) !== JSON.stringify(snapshot)) fail()
  validateNeonEvidence(policy, config.driver.host)
  if (digest(policy) !== policyDigest) fail()
  return { policy, policyDigest, digest: digest(snapshot), at: performance.now() }
}

export async function verifyProviderConnect(client, config, snapshot, inspectRole, probe = probeProviderDatabase) {
  const generation = Symbol('provider-check')
  generations.set(snapshot, generation)
  approvals.delete(snapshot)
  try {
    const approval = await verifyConnect(client, config, snapshot, inspectRole, probe)
    if (generations.get(snapshot) !== generation) fail()
    approvals.set(snapshot, approval)
  } catch {
    if (generations.get(snapshot) === generation) approvals.delete(snapshot)
    fail()
  }
}
