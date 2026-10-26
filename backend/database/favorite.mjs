import { DatabaseConfigError } from './config.mjs'

const sameColumns = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((name, index) => name === expected[index])

// Chỉ đọc catalog của Favorite và khóa FK; không đọc bất kỳ bản ghi auth nào.
export async function assertFavoriteSchema(client) {
  const columns = await client.$queryRaw`
    SELECT column_name AS name, udt_name AS type, is_nullable = 'NO' AS required,
           datetime_precision AS precision
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Favorite'
    ORDER BY ordinal_position
  `
  const constraints = await client.$queryRaw`
    SELECT con.conname AS name, con.contype::text AS type, con.convalidated AS valid,
           con.confdeltype::text AS "onDelete", con.confupdtype::text AS "onUpdate",
           rn.nspname AS "referencedSchema", rc.relname AS "referencedTable",
           ARRAY(SELECT a.attname::text
                 FROM unnest(con.conkey) WITH ORDINALITY AS k(num, position)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num
                 ORDER BY k.position) AS columns,
           ARRAY(SELECT a.attname::text
                 FROM unnest(con.confkey) WITH ORDINALITY AS k(num, position)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num
                 ORDER BY k.position) AS "referencedColumns"
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
    LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'Favorite'
  `
  const indexes = await client.$queryRaw`
    SELECT ic.relname AS name, i.indisunique AS unique, i.indisvalid AND i.indisready AS valid,
           i.indpred IS NULL AND i.indexprs IS NULL AS complete, am.amname AS method,
           ARRAY(SELECT a.attname::text
                 FROM unnest(i.indkey) WITH ORDINALITY AS k(num, position)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num
                 WHERE k.position <= i.indnkeyatts ORDER BY k.position) AS columns
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = ic.relam
    WHERE n.nspname = 'public' AND c.relname = 'Favorite'
  `
  const expectedColumns = [
    ['id', 'uuid'],
    ['userId', 'uuid'],
    ['movieId', 'int4'],
    ['createdAt', 'timestamptz'],
  ]
  const columnsValid =
    columns.length === expectedColumns.length &&
    columns.every(
      (column, index) =>
        column.name === expectedColumns[index][0] &&
        column.type === expectedColumns[index][1] &&
        column.required &&
        (column.name !== 'createdAt' || column.precision === 3),
    )
  const primaryValid = constraints.some(
    (key) => key.type === 'p' && key.valid && sameColumns(key.columns, ['id']),
  )
  const foreignValid = constraints.some(
    (key) =>
      key.type === 'f' &&
      key.valid &&
      sameColumns(key.columns, ['userId']) &&
      key.referencedSchema === 'public' &&
      key.referencedTable === 'User' &&
      sameColumns(key.referencedColumns, ['id']) &&
      key.onDelete === 'c' &&
      key.onUpdate === 'c',
  )
  const hasIndex = (names, unique) =>
    indexes.some(
      (index) =>
        index.valid &&
        index.complete &&
        index.method === 'btree' &&
        index.unique === unique &&
        sameColumns(index.columns, names),
    )
  if (
    !columnsValid ||
    !primaryValid ||
    !foreignValid ||
    !hasIndex(['userId', 'movieId'], true) ||
    !hasIndex(['userId', 'createdAt'], false)
  )
    throw new DatabaseConfigError(
      'Favorite thiếu hoặc sai cột, khóa chính, unique index, index theo User hoặc foreign key Cascade. Dừng để review; không tự sửa/reset dữ liệu.',
    )
  return { columns, constraints, indexes }
}
