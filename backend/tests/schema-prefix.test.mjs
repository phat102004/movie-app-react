import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

for (const schema of ['pgx', 'pgworkspace']) {
  test(`production bootstrap refuses an existing ${schema} relation before creating roles (real RAM PostgreSQL)`, async () => {
    const db = new PGlite()
    try {
      // Both names are fixed fixture identifiers, never caller-provided SQL.
      await db.exec(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.existing_fixture(id integer)`)
      const source = await readFile(new URL('../database/production-roles.sql', import.meta.url), 'utf8')
      const bootstrap = source.split('-- BOOTSTRAP_BEGIN')[1].split('-- BOOTSTRAP_END')[0].replaceAll('cineverse_prod', 'postgres')
      await assert.rejects(db.exec(bootstrap), /roles\/objects already exist/)
      assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_catalog.pg_roles WHERE rolname IN ('cineverse_app','cineverse_migrator')")).rows[0].count, 0)
      assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${schema}.existing_fixture`)).rows[0].count, 0)
    } finally { await db.close() }
  })
}
