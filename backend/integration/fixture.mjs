import assert from 'node:assert/strict'
import { Client } from 'pg'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createDatabaseClient } from '../database/client.mjs'
import { reviewedProductionMigrations } from '../database/production-migration-plan.mjs'
import { readNativeTestConfig, nativeDatabase, nativeCluster, bootstrapRole, runtimePassword, migratorPassword } from './config.mjs'

const run = promisify(execFile)
export async function migrateNativeFixture() {
  // Configuration is revalidated before each CLI invocation.
  readNativeTestConfig()
  const args = ['node_modules/prisma/build/index.js', 'migrate']
  async function prisma(command) {
    try {
      await run(process.execPath, [...args, ...command, '--config', 'backend/integration/prisma.config.mjs'], {
        windowsHide: true, timeout: 60_000, maxBuffer: 512_000,
        env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', MIGRATION_DATABASE_URL: '' },
      })
    } catch {
      throw new Error('Isolated native Prisma migration/history/drift command failed; raw output hidden. Review fixture roles/target, never reset a user database.')
    }
  }
  await prisma(['deploy'])
  // Deploy must be idempotent; no baseline, reset, db push or schema edits.
  await prisma(['deploy'])
  await prisma(['diff', '--from-config-datasource', '--to-schema', 'backend/prisma/schema.prisma', '--exit-code'])
}

export async function nativeFixture() {
  const config = readNativeTestConfig()
  const admin = new Client(config.driver)
  const resources = [admin]
  let a, b, migrator
  async function close() {
    await Promise.allSettled([a?.$disconnect(), b?.$disconnect(), migrator?.$disconnect()])
    await Promise.allSettled(resources.map(client => client.end()))
  }
  try {
    await admin.connect()
    // All checks below are read-only BEFORE the first DDL. This must be a new,
    // dedicated cluster, not just a conveniently named DB on a developer server.
    const { rows: [identity] } = await admin.query(`SELECT current_database() AS database, current_user AS role,
      inet_server_port() AS port, current_setting('cluster_name') AS cluster, current_setting('server_version_num')::int AS version`)
    assert.equal(identity.database, nativeDatabase)
    assert.equal(identity.role, bootstrapRole)
    // Docker publishes a random host port while PostgreSQL itself listens on 5432.
    assert.equal(identity.port, config.serverPort)
    assert.equal(identity.cluster, nativeCluster, 'Refuse cluster without the disposable marker.')
    assert.equal(Math.floor(identity.version / 10_000), 17)
    const databases = (await admin.query('SELECT datname FROM pg_catalog.pg_database ORDER BY datname')).rows.map(row => row.datname)
    assert.deepEqual(databases, ['cineverse_ci', 'postgres', 'template0', 'template1'])
    const objects = await admin.query(`SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`)
    assert.equal(objects.rowCount, 0, 'Refuse nonempty database; recreate the disposable cluster, never reset it.')
    const otherRoles = await admin.query(`SELECT rolname FROM pg_catalog.pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname <> $1`, [bootstrapRole])
    assert.equal(otherRoles.rowCount, 0, 'Refuse shared cluster with existing roles.')
    const sql = await readFile(new URL('../database/production-roles.sql', import.meta.url), 'utf8')
    const bootstrap = sql.split('-- BOOTSTRAP_BEGIN')[1]?.split('-- BOOTSTRAP_END')[0]
    assert.ok(bootstrap)
    await admin.query('BEGIN')
    // Only the fixed DB identifier changes; grants/flags match reviewed production SQL.
    await admin.query(bootstrap.replaceAll('cineverse_prod', nativeDatabase))
    // Other-DB PUBLIC revocation is safe ONLY in this verified disposable cluster.
    for (const name of ['postgres', 'template0', 'template1'])
      await admin.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${name} FROM PUBLIC`)
    await admin.query(`ALTER ROLE cineverse_app PASSWORD '${runtimePassword}'`)
    await admin.query(`ALTER ROLE cineverse_migrator PASSWORD '${migratorPassword}'`)
    await admin.query('COMMIT')
    await migrateNativeFixture()
    const grantSql = await readFile(new URL('../database/production-runtime-grants.sql', import.meta.url), 'utf8')
    const grants = grantSql.split('-- RUNTIME_GRANTS_BEGIN')[1]?.split('-- RUNTIME_GRANTS_END')[0]
    assert.ok(grants)
    await admin.query(grants)
    a = await createDatabaseClient(config.runtime)
    b = await createDatabaseClient(config.runtime)
    migrator = await createDatabaseClient(config.migration)
    const history = await migrator.$queryRaw`SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS rolled_back FROM public._prisma_migrations ORDER BY started_at`
    const expected = await reviewedProductionMigrations()
    assert.equal(history.length, expected.length)
    history.forEach((row, index) => {
      assert.equal(row.name, expected[index].name)
      assert.ok(expected[index].checksums.includes(row.checksum))
      assert.ok(row.finished)
      assert.equal(row.rolled_back, null)
    })
    return {
      a, b, migrator, admin, config, close,
      async connection() {
        const client = new Client(config.runtime.driver)
        resources.push(client)
        await client.connect()
        return client
      },
      async blockedBy(pid, minimum = 1) {
        const deadline = Date.now() + 4000
        while (Date.now() < deadline) {
          const result = await admin.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity
            WHERE datname=$1 AND $2::int = ANY(pg_catalog.pg_blocking_pids(pid))`, [nativeDatabase, pid])
          if (result.rows[0].count >= minimum) return
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('Expected native connection lock wait was not observed.')
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
