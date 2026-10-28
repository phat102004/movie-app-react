import { DatabaseConfigError } from './config.mjs'

export const applicationTables = ['User', 'Session', 'PasswordResetToken', 'Favorite']
const fail = (reason) => {
  throw new DatabaseConfigError(`Database production không đạt least privilege (${reason}). Dừng để DBA review; không tự cấp quyền hoặc đổi owner.`)
}

export function validateProductionRole(snapshot, purpose) {
  const id = snapshot.identity
  const runtime = purpose === 'runtime'
  if (!['runtime', 'migration'].includes(purpose)) fail('PURPOSE')
  const expected = runtime ? 'cineverse_app' : 'cineverse_migrator'
  if (!id || id.database !== 'cineverse_prod' || id.role !== expected || id.sessionRole !== expected)
    fail('IDENTITY')
  if (id.canLogin !== true || id.superuser !== false || id.createDb !== false ||
    id.createRole !== false || id.replication !== false || id.bypassRls !== false ||
    id.inherit !== false || id.memberships !== 0) fail('ROLE_ATTRIBUTES_OR_MEMBERSHIP')
  if (id.dbOwner !== false || id.dbConnect !== true || id.dbTemp !== false ||
    id.dbCreate !== !runtime || id.otherDatabaseConnect !== false) fail('DATABASE_PRIVILEGES')
  const schema = snapshot.schemas.find(row => row.name === 'public')
  if (!schema || schema.usage !== true || schema.create !== !runtime) fail('SCHEMA_PRIVILEGES')
  if (runtime && (id.ownsObjects !== false || id.unsafeRoutines !== false || snapshot.schemas.some(row => row.owner || row.create || (row.name !== 'public' && row.usage))))
    fail('RUNTIME_OWNERSHIP_OR_DDL')
  if (runtime) {
    for (const name of applicationTables) {
      const row = snapshot.tables.find(row => row.schema === 'public' && row.name === name)
      if (!row || row.kind !== 'r' || ![row.select, row.insert, row.update, row.delete].every(value => value === true) ||
        [row.truncate, row.references, row.trigger, row.grantOption, row.columnGrantOption].some(value => value !== false)) fail('APPLICATION_TABLE_PRIVILEGES')
    }
    for (const row of snapshot.tables) {
      if (row.schema === 'public' && applicationTables.includes(row.name)) continue
      if ([row.select, row.insert, row.update, row.delete, row.truncate, row.references, row.trigger, row.grantOption, row.columnAccess, row.columnGrantOption]
        .some(value => value !== false)) fail('EXTRA_TABLE_OR_MIGRATION_HISTORY_ACCESS')
    }
    // Current models use client-generated UUIDs, not sequences.
    if (snapshot.sequences.some(row => row.usage || row.select || row.update || row.owner))
      fail('UNEXPECTED_SEQUENCE_PRIVILEGES')
  } else {
    for (const row of snapshot.tables.filter(row => row.schema === 'public'))
      if (![...applicationTables, '_prisma_migrations'].includes(row.name) || row.owner !== true)
        fail('MIGRATION_OBJECT_OWNERSHIP')
  }
}

// Only PostgreSQL metadata/ACLs. Never selects password hashes or application rows.
export async function inspectRoleSecurity(client) {
  const [identity] = await client.$queryRaw`
    SELECT current_database()::text AS database, current_user::text AS role,
      session_user::text AS "sessionRole", r.rolcanlogin AS "canLogin",
      r.rolsuper AS superuser, r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole",
      r.rolreplication AS replication, r.rolbypassrls AS "bypassRls", r.rolinherit AS inherit,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members WHERE member = r.oid) AS memberships,
      d.datdba = r.oid AS "dbOwner",
      has_database_privilege(current_user, d.oid, 'CONNECT') AS "dbConnect",
      has_database_privilege(current_user, d.oid, 'CREATE') AS "dbCreate",
      has_database_privilege(current_user, d.oid, 'TEMP') AS "dbTemp",
      EXISTS(SELECT 1 FROM pg_catalog.pg_database x WHERE x.datallowconn AND x.oid <> d.oid
        AND has_database_privilege(current_user, x.oid, 'CONNECT')) AS "otherDatabaseConnect",
      EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
        AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS "unsafeRoutines",
      (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = r.oid AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')
       OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proowner = r.oid AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')
       OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typowner = r.oid AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')) AS "ownsObjects"
    FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datname = current_database()
    WHERE r.rolname = current_user
  `
  const schemas = await client.$queryRaw`
    SELECT nspname::text AS name, nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
      has_schema_privilege(current_user, oid, 'USAGE') AS usage,
      has_schema_privilege(current_user, oid, 'CREATE') AS create
    FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
  `
  const tables = await client.$queryRaw`
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind,
      c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
      has_table_privilege(current_user, c.oid, 'SELECT') AS select,
      has_table_privilege(current_user, c.oid, 'INSERT') AS insert,
      has_table_privilege(current_user, c.oid, 'UPDATE') AS update,
      has_table_privilege(current_user, c.oid, 'DELETE') AS delete,
      has_table_privilege(current_user, c.oid, 'TRUNCATE') AS truncate,
      has_table_privilege(current_user, c.oid, 'REFERENCES') AS references,
      has_table_privilege(current_user, c.oid, 'TRIGGER') AS trigger,
      (has_any_column_privilege(current_user, c.oid, 'SELECT') OR
       has_any_column_privilege(current_user, c.oid, 'INSERT') OR
       has_any_column_privilege(current_user, c.oid, 'UPDATE') OR
       has_any_column_privilege(current_user, c.oid, 'REFERENCES')) AS "columnAccess",
      (has_any_column_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION') OR
       has_any_column_privilege(current_user, c.oid, 'INSERT WITH GRANT OPTION') OR
       has_any_column_privilege(current_user, c.oid, 'UPDATE WITH GRANT OPTION') OR
       has_any_column_privilege(current_user, c.oid, 'REFERENCES WITH GRANT OPTION')) AS "columnGrantOption",
      (has_table_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION') OR
       has_table_privilege(current_user, c.oid, 'INSERT WITH GRANT OPTION') OR
       has_table_privilege(current_user, c.oid, 'UPDATE WITH GRANT OPTION') OR
       has_table_privilege(current_user, c.oid, 'DELETE WITH GRANT OPTION')) AS "grantOption"
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f')
  `
  const sequences = await client.$queryRaw`
    SELECT c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
      has_sequence_privilege(current_user, c.oid, 'USAGE') AS usage,
      has_sequence_privilege(current_user, c.oid, 'SELECT') AS select,
      has_sequence_privilege(current_user, c.oid, 'UPDATE') AS update
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind = 'S'
  `
  return { identity, schemas, tables, sequences }
}

export async function assertProductionRole(client, config) {
  if (config.production) validateProductionRole(await inspectRoleSecurity(client), config.purpose)
}
