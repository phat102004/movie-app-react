import { DatabaseConfigError } from './config.mjs'

const fail = reason => { throw new DatabaseConfigError(`Managed V1 chưa đạt (${reason}). Không tự sửa ACL; chi tiết nội bộ đã được ẩn.`) }

// Supplement, never replace, the shared role/schema/table/column/sequence inspector.
export async function inspectManagedPrivileges(client) {
  const [settings] = await client.$queryRaw`
    SELECT pg_catalog.current_setting('search_path') AS path,
      EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n
        WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
          AND pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE WITH GRANT OPTION')) AS "schemaGrantOption",
      EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n
        WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
          AND pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE WITH GRANT OPTION')) AS "schemaCreateGrantOption",
      EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n,
        LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
        WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'USAGE') AS "publicSchemaUsage",
      EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n,
        LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
        WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
          AND a.grantee = 0 AND a.privilege_type = 'CREATE') AS "publicSchemaCreate",
      EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ((LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema') OR n.oid = pg_catalog.pg_my_temp_schema())
          AND (p.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
            OR pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE'))) AS routines,
      EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        LEFT JOIN pg_catalog.pg_type element ON element.oid = t.typelem
        WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
          AND t.typowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace cn ON cn.oid = c.relnamespace
            WHERE c.oid IN (t.typrelid, element.typrelid) AND cn.nspname = 'public' AND c.relkind = 'r'
              AND c.relname IN ('User','Session','PasswordResetToken','Favorite','_prisma_migrations'))) AS "ownedCustomTypes"
  `
  const maintenance = await client.$queryRaw`
    SELECT n.nspname::text AS schema, c.relname::text AS name,
      pg_catalog.has_table_privilege(current_user, c.oid, 'MAINTAIN') AS maintain
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','m')
    ORDER BY n.nspname, c.relname
  `
  return { ...settings, maintenance }
}

export function validateManagedPrivileges(snapshot, expected, purpose = 'provider') {
  const extra = snapshot.managed
  const target = purpose !== 'provider', migration = purpose === 'migration'
  const path = extra?.path?.replaceAll(' ', '')
  if (!extra || !['pg_catalog,public,pg_temp', 'pg_catalog,pg_temp'].includes(path) ||
    (target && path !== 'pg_catalog,public,pg_temp')) fail('SEARCH_PATH')
  if (extra.schemaGrantOption !== false || extra.schemaCreateGrantOption !== false || extra.publicSchemaCreate !== false ||
    extra.publicSchemaUsage !== expected.publicSchemaUsage) fail('SCHEMA_DEFAULTS')
  if (extra.routines !== false || extra.ownedCustomTypes !== false) fail('ROUTINES_OR_TYPES')
  if (snapshot.schemas.some(row => row.owner !== false || row.create !== (migration && row.name === 'public') ||
    row.usage !== (row.name === 'public' && (target || expected.publicSchemaUsage)))) fail('SCHEMA_ACL')
  if (snapshot.sequences.some(row => ['usage','select','update','owner'].some(key => row[key] !== false))) fail('SEQUENCE_ACL')
  if (!Array.isArray(extra.maintenance) || extra.maintenance.some(row => row.maintain !== false &&
    !(migration && row.schema === 'public' && ['User','Session','PasswordResetToken','Favorite','_prisma_migrations'].includes(row.name)))) fail('MAINTAIN')
  if (migration && snapshot.tables.some(row => row.schema !== 'public' &&
    ['owner','select','insert','update','delete','truncate','references','trigger','grantOption','columnAccess','columnGrantOption'].some(key => row[key] !== false))) fail('MIGRATOR_EXTRA_TABLE_ACL')
}

export function validateManagedDatabase(row, expected, purpose = 'provider') {
  const migration = purpose === 'migration'
  if (!row || row.temp !== expected.publicTemporary || row.publicTemporary !== expected.publicTemporary ||
    row.directTemporary !== false || row.tempGrantOption !== false || row.createGrantOption !== false ||
    row.connectGrantOption !== false || row.publicCreate !== false || row.create !== migration) fail('DATABASE_DEFAULTS')
}
