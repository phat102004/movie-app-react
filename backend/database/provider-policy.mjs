import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { DatabaseConfigError } from './config.mjs'

const fail = () => { throw new DatabaseConfigError('Managed database policy chưa được xác minh. Cần evidence Neon đã review, đúng endpoint/identity và còn hạn; không tự miễn trừ theo tên database.') }
const oid = value => Number.isInteger(value) && value > 0 && value <= 4294967295
const label = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{2,100}$/.test(value)
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',')
const owner = row => oid(row.ownerOid) && label(row.owner) &&
  !['cineverse_app', 'cineverse_migrator', 'neon_superuser', 'pg_database_owner'].includes(row.owner)

// This is an operator-reviewed attestation, not proof obtained from an untrusted
// database name. No TOFU collector, cloud API call or environment auto-detection.
export function validateNeonEvidence(value, host, now = Date.now()) {
  if (!keys(value, ['version', 'provider', 'host', 'projectId', 'branchId', 'endpointId',
    'reviewRef', 'reviewedAt', 'expiresAt', 'target', 'systemDatabases']) ||
    value.version !== 1 || value.provider !== 'neon' || value.host !== host || typeof host !== 'string' ||
    !label(value.projectId) || !/^br-[a-z0-9-]+$/.test(value.branchId) ||
    !/^ep-[a-z0-9-]+$/.test(value.endpointId) || value.endpointId.endsWith('-pooler') ||
    !host.startsWith(value.endpointId + '.') || !host.endsWith('.neon.tech') ||
    !label(value.reviewRef)) fail()
  const reviewed = Date.parse(value.reviewedAt), expires = Date.parse(value.expiresAt)
  if (!Number.isFinite(reviewed) || !Number.isFinite(expires) || reviewed > now ||
    expires <= now || expires <= reviewed || expires - reviewed > 86_400_000) fail()
  const target = value.target
  if (!keys(target, ['name', 'oid', 'owner', 'ownerOid']) ||
    target.name !== 'cineverse_prod' || !oid(target.oid) || !owner(target)) fail()
  if (!Array.isArray(value.systemDatabases) || value.systemDatabases.length !== 2) fail()
  const rows = value.systemDatabases
  for (const [name, isTemplate] of [['postgres', false], ['template1', true]]) {
    const row = rows.find(row => row?.name === name)
    if (!keys(row, ['name', 'oid', 'owner', 'ownerOid', 'isTemplate']) ||
      !oid(row.oid) || !owner(row) || row.isTemplate !== isTemplate ||
      row.ownerOid === target.ownerOid || row.owner === target.owner) fail()
  }
  if (new Set([target.oid, ...rows.map(row => row.oid)]).size !== 3) fail()
  return Object.freeze({ ...value, target: Object.freeze({ ...target }),
    systemDatabases: Object.freeze(rows.map(row => Object.freeze({ ...row }))) })
}

export function readDatabaseSecurityPolicy(env, host) {
  const mode = env.DATABASE_SECURITY_POLICY ?? 'strict'
  const file = env.DATABASE_PROVIDER_EVIDENCE_FILE
  if (mode === 'strict' && !file) return undefined
  if (mode !== 'neon-reviewed-system-connect' || env.NODE_ENV !== 'production' ||
    typeof file !== 'string' || !isAbsolute(file)) fail()
  let value, fd
  try {
    fd = openSync(file, 'r')
    if (!fstatSync(fd).isFile()) fail()
    const buffer = Buffer.alloc(8193)
    const size = readSync(fd, buffer, 0, buffer.length, 0)
    if (size > 8192) fail()
    value = JSON.parse(buffer.subarray(0, size).toString('utf8'))
  } catch { fail() } finally { if (fd !== undefined) closeSync(fd) }
  return validateNeonEvidence(value, host)
}
