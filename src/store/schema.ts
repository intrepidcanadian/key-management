import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Schema is hosted-ready: `owner_id` exists now (seeded to a single local owner),
 * so multi-tenant is additive later. See design doc.
 *
 *   keys 1───* grants 1───* audit
 *
 * Secrets at rest: keys store ONLY ciphertext + nonce + wrappedDek (envelope crypto).
 * Grant tokens are stored HASHED (token_hash) — a DB leak yields no usable tokens.
 * Audit stores request METADATA only — never request/response bodies.
 */

export const keys = sqliteTable("keys", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local"),
  provider: text("provider").notNull(), // e.g. "openai", "stripe"
  label: text("label").notNull(),
  ciphertext: text("ciphertext").notNull(), // base64
  nonce: text("nonce").notNull(), // base64
  wrappedDek: text("wrapped_dek").notNull(), // base64
  createdAt: integer("created_at").notNull(),
  rotatedAt: integer("rotated_at"),
});

export const grants = sqliteTable("grants", {
  id: text("id").primaryKey(),
  keyId: text("key_id")
    .notNull()
    .references(() => keys.id),
  granteeLabel: text("grantee_label").notNull(),
  granteeType: text("grantee_type", { enum: ["agent", "human"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(), // sha256 hex of the grant token
  scopeJson: text("scope_json").notNull(), // provider-specific scope
  spendCapCents: integer("spend_cap_cents"),
  spentCents: real("spent_cents").notNull().default(0),
  rateLimitPerMin: integer("rate_limit_per_min"), // null = unlimited
  expiresAt: integer("expires_at"), // epoch ms; null = no expiry
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  grantId: text("grant_id")
    .notNull()
    .references(() => grants.id),
  ts: integer("ts").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  upstreamStatus: integer("upstream_status"),
  bytesIn: integer("bytes_in"),
  bytesOut: integer("bytes_out"),
  estCostCents: real("est_cost_cents"),
});

export type KeyRow = typeof keys.$inferSelect;
export type GrantRow = typeof grants.$inferSelect;
