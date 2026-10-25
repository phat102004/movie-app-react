import { DatabaseConfigError } from './config.mjs'

export const initialMigration = '20261026000000_init_user_model'
export const sessionMigration = '20261026010000_add_session_model'
export const passwordResetMigration = '20261026020000_add_password_reset_token'
export const knownMigrations = [
  initialMigration,
  sessionMigration,
  passwordResetMigration,
]

// Chỉ chấp nhận một prefix liên tục của lịch sử đã review và đúng checksum.
export function migrationState(snapshot, expected) {
  if (
    snapshot.database !== 'cineverse_dev' ||
    snapshot.migrations.length > expected.length
  )
    throw new DatabaseConfigError(
      'Đã dừng: database hoặc lịch sử migration không hợp lệ.',
    )
  snapshot.migrations.forEach((migration, index) => {
    if (
      migration.name !== expected[index].name ||
      migration.checksum !== expected[index].checksum ||
      !migration.finished ||
      migration.rolled_back
    )
      throw new DatabaseConfigError(
        'Đã dừng: migration không khớp tên/checksum hoặc chưa hoàn thành; cần review, không baseline/reset.',
      )
  })
  const count = snapshot.migrations.length
  const allowed =
    count === 0
      ? []
      : count === 1
        ? ['User']
        : count === 2
          ? ['User', 'Session']
          : ['User', 'Session', 'PasswordResetToken']
  const actual = snapshot.objects.filter(
    (item) =>
      !(
        item.schema === 'public' &&
        item.name === '_prisma_migrations' &&
        item.kind === 'r'
      ),
  )
  if (
    actual.length !== allowed.length ||
    actual.some(
      (item) =>
        item.schema !== 'public' ||
        item.kind !== 'r' ||
        !allowed.includes(item.name),
    )
  )
    throw new DatabaseConfigError(
      'Đã dừng: có bảng/view/sequence không phù hợp lịch sử đã review.',
    )
  return count
}

export async function inspectDatabase(client) {
  // Chỉ đọc metadata. Không đọc email, passwordHash hoặc các bản ghi User.
  const [identity] = await client.$queryRaw`
    SELECT current_database() AS database, current_setting('server_version') AS version
  `
  const objects = await client.$queryRaw`
  SELECT
    n.nspname AS schema,
    c.relname AS name,
    c.relkind::text AS kind
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT LIKE 'pg_%'
    AND n.nspname <> 'information_schema'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  ORDER BY n.nspname, c.relname
`
  if (identity.database !== 'cineverse_dev') {
    throw new DatabaseConfigError(
      'Đã dừng: kết nối thực tế không phải database cineverse_dev.',
    )
  }
  const hasHistory = objects.some(
    (item) =>
      item.schema === 'public' &&
      item.name === '_prisma_migrations' &&
      item.kind === 'r',
  )
  const migrations = hasHistory
    ? await client.$queryRaw`
        SELECT migration_name AS name, checksum, finished_at AS finished,
               rolled_back_at AS rolled_back
        FROM public._prisma_migrations ORDER BY started_at
      `
    : []
  return { ...identity, objects, migrations }
}

export function initialMigrationState(snapshot, checksum) {
  if (snapshot.database !== 'cineverse_dev')
    throw new DatabaseConfigError('Đã dừng: database không phải cineverse_dev.')

  const applicationObjects = snapshot.objects.filter(
    (item) =>
      !(
        item.schema === 'public' &&
        item.name === '_prisma_migrations' &&
        item.kind === 'r'
      ),
  )
  if (!applicationObjects.length && !snapshot.migrations.length) return 'empty'

  const [migration] = snapshot.migrations
  if (
    applicationObjects.length === 1 &&
    applicationObjects[0].schema === 'public' &&
    applicationObjects[0].name === 'User' &&
    applicationObjects[0].kind === 'r' &&
    snapshot.migrations.length === 1 &&
    migration.name === initialMigration &&
    migration.checksum === checksum &&
    migration.finished &&
    !migration.rolled_back
  )
    return 'applied'

  throw new DatabaseConfigError(
    'Đã dừng: database có cấu trúc hoặc lịch sử migration hiện hữu cần xem xét. Không tự baseline, reset hay xóa dữ liệu. Kiểm tra trong pgAdmin trước.',
  )
}
