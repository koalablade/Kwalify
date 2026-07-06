-- Idempotent local dev database for Kwalify.
-- Run via scripts/setup-local-postgres.ps1

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kwalify') THEN
    CREATE ROLE kwalify LOGIN PASSWORD 'kwalify';
  ELSE
    ALTER ROLE kwalify WITH LOGIN PASSWORD 'kwalify';
  END IF;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', 'kwalify', 'kwalify')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kwalify')\gexec

GRANT ALL PRIVILEGES ON DATABASE kwalify TO kwalify;
