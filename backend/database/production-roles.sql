-- MANUAL ONLY. New dedicated production database, not an upgrade of cineverse_dev.
-- DBA: psql <admin connection configured outside argv> -X -v CINEVERSE_PROVISION=true -f backend/database/production-roles.sql
-- Roles are created with NO password; set each with psql \password / secret manager.
-- Never place credentials in this file, argv, terminal logs or source control.
\set ON_ERROR_STOP on
\if :{?CINEVERSE_PROVISION}
  \if :CINEVERSE_PROVISION
  \else
    \quit 3
  \endif
\else
  \echo 'Stopped: explicit CINEVERSE_PROVISION=true is required.'
  \quit 3
\endif
SELECT current_database() = 'cineverse_prod' AS target_ok \gset
\if :target_ok
\else
  \echo 'Stopped: target must be cineverse_prod; never run against cineverse_dev.'
  \quit 3
\endif

BEGIN;
-- BOOTSTRAP_BEGIN
-- Also exercised against isolated PostgreSQL WASM fixtures.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('cineverse_app', 'cineverse_migrator'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'public')
  THEN RAISE EXCEPTION 'Stopped: roles/objects already exist or public is absent. DBA must review; no automatic ownership transfer.';
  END IF;
END $$;

CREATE ROLE cineverse_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL;
CREATE ROLE cineverse_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL;

-- Dedicated NEW database only. PUBLIC grants are additive and must be removed.
REVOKE CONNECT, TEMPORARY ON DATABASE cineverse_prod FROM PUBLIC;
REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE cineverse_prod TO cineverse_app, cineverse_migrator;
-- Needed even for CREATE SCHEMA IF NOT EXISTS in the unchanged initial migration.
-- CREATE on this database is NOT the CREATEDB role attribute.
GRANT CREATE ON DATABASE cineverse_prod TO cineverse_migrator;
GRANT USAGE ON SCHEMA public TO cineverse_app;
GRANT USAGE, CREATE ON SCHEMA public TO cineverse_migrator;
ALTER ROLE cineverse_app IN DATABASE cineverse_prod SET search_path = pg_catalog, public;
ALTER ROLE cineverse_migrator IN DATABASE cineverse_prod SET search_path = pg_catalog, public;
-- BOOTSTRAP_END
COMMIT;

-- Mandatory DBA follow-up BEFORE credentials/runtime activation:
-- 1. Review PUBLIC CONNECT on OTHER databases (postgres/template1/tenant DBs).
--    A direct REVOKE from app alone cannot override PUBLIC. This script does not
--    change other databases. Strict role checks will fail until their ACLs are confined.
-- 2. Set independent passwords interactively; configure SCRAM/TLS/network ACLs.
-- 3. Run production migration preflight/deploy with migrator credentials only.
-- 4. Review and run production-runtime-grants.sql AFTER migrations, then role check.
-- No default table privileges: they could accidentally grant _prisma_migrations.
