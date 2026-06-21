import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

/** Vault directory (no side effects). Override with KEYVAULT_HOME. */
export function vaultHome(): string {
  return process.env.KEYVAULT_HOME ?? join(homedir(), ".keyvault");
}

/** Vault DB path (no side effects). Override with KEYVAULT_DB. */
export function vaultDbPath(): string {
  return process.env.KEYVAULT_DB ?? join(vaultHome(), "vault.sqlite");
}

let _db: DB | null = null;
let _raw: Database.Database | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const path = vaultDbPath();
  mkdirSync(dirname(path), { recursive: true });
  _raw = new Database(path);
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("foreign_keys = ON");
  initSchema(_raw);
  _db = drizzle(_raw, { schema });
  return _db;
}

/** In-memory DB for tests. */
export function getTestDb(): DB {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  initSchema(raw);
  return drizzle(raw, { schema });
}

/**
 * Raw DDL so the vault is usable without a separate drizzle-kit migration step.
 * Keep in sync with schema.ts.
 */
export function initSchema(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL DEFAULT 'local',
      provider    TEXT NOT NULL,
      label       TEXT NOT NULL,
      ciphertext  TEXT NOT NULL,
      nonce       TEXT NOT NULL,
      wrapped_dek TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      rotated_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS grants (
      id              TEXT PRIMARY KEY,
      key_id          TEXT NOT NULL REFERENCES keys(id),
      grantee_label   TEXT NOT NULL,
      grantee_type    TEXT NOT NULL,
      token_hash      TEXT NOT NULL UNIQUE,
      scope_json      TEXT NOT NULL,
      spend_cap_cents     INTEGER,
      spent_cents         REAL NOT NULL DEFAULT 0,
      rate_limit_per_min  INTEGER,
      expires_at          INTEGER,
      revoked_at      INTEGER,
      created_at      INTEGER NOT NULL
    );
    -- token_hash is looked up on every proxied request.
    CREATE INDEX IF NOT EXISTS idx_grants_token_hash ON grants(token_hash);

    CREATE TABLE IF NOT EXISTS audit (
      id              TEXT PRIMARY KEY,
      grant_id        TEXT NOT NULL REFERENCES grants(id),
      ts              INTEGER NOT NULL,
      method          TEXT NOT NULL,
      path            TEXT NOT NULL,
      upstream_status INTEGER,
      bytes_in        INTEGER,
      bytes_out       INTEGER,
      est_cost_cents  REAL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_grant ON audit(grant_id);
  `);
}
