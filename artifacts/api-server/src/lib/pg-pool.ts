import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const SESSION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "session" (
    "sid"    VARCHAR      NOT NULL PRIMARY KEY,
    "sess"   JSON         NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;
