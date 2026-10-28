import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { DatabaseConfigError } from './config.mjs'
import { applicationTables } from './role-security.mjs'

const reviewed = [
  ['20261026000000_init_user_model', '5193864cdf36e50d4b2a17484c37fa589889082ad6043d89fe3347b9c99a86cc'],
  ['20261026010000_add_session_model', '455d62597da3165df4cd25fda05ad070162dcee6a279e7029e98e3f39ecc227c'],
  ['20261026020000_add_password_reset_token', 'e8268375c2b987f2caacc24dbc3b05d1f60e8bc8a70a846c3fb9846ff4335179'],
  ['20261026030000_add_favorite_model', '924121aec88ee2ca8f55dcef6ca1913bc011ff6db202c52f1b3aa1dd70e3d378'],
]
const hash = text => createHash('sha256').update(text).digest('hex')
const fail = () => { throw new DatabaseConfigError('Production migration chưa được xác minh: inventory/history/checksum không khớp. Không tự baseline, reset, đổi owner hoặc sửa dữ liệu.') }

export async function reviewedProductionMigrations() {
  const base = new URL('../prisma/migrations/', import.meta.url)
  const actual = (await readdir(base, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name).sort()
  if (JSON.stringify(actual) !== JSON.stringify(reviewed.map(row => row[0]))) fail()
  return Promise.all(reviewed.map(async ([name, checksum]) => {
    const sql = (await readFile(new URL(`${name}/migration.sql`, base), 'utf8')).replaceAll('\r\n', '\n')
    if (hash(sql) !== checksum) fail()
    return { name, checksums: [checksum, hash(sql.replaceAll('\n', '\r\n'))] }
  }))
}

export function productionMigrationState(snapshot, expected) {
  if (snapshot.database !== 'cineverse_prod' || snapshot.migrations.length > expected.length) fail()
  snapshot.migrations.forEach((row, index) => {
    const target = expected[index]
    if (row.name !== target.name || !target.checksums.includes(row.checksum) || !row.finished || row.rolled_back) fail()
  })
  const count = snapshot.migrations.length
  const allowed = applicationTables.slice(0, count)
  const objects = snapshot.objects.filter(row => !(row.schema === 'public' && row.name === '_prisma_migrations' && row.kind === 'r'))
  if (objects.length !== allowed.length || objects.some(row => row.schema !== 'public' || row.kind !== 'r' || !allowed.includes(row.name))) fail()
  return count
}

export async function inspectProductionMigration(client) {
  const [identity] = await client.$queryRaw`SELECT current_database()::text AS database`
  if (identity.database !== 'cineverse_prod') fail()
  const objects = await client.$queryRaw`
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
  `
  const hasHistory = objects.some(row => row.schema === 'public' && row.name === '_prisma_migrations' && row.kind === 'r')
  const migrations = hasHistory ? await client.$queryRaw`
    SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS rolled_back
    FROM public._prisma_migrations ORDER BY started_at
  ` : []
  return { ...identity, objects, migrations }
}
