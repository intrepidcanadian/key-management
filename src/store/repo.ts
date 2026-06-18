import { randomBytes, createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "./db.js";
import { keys, grants, audit, type KeyRow, type GrantRow } from "./schema.js";
import { sealApiKey, type SealedKey } from "../crypto/cipher.js";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** Grant tokens are bearer credentials: high-entropy random, stored only as a hash. */
export function mintToken(): string {
  return "gv_" + randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface KeyInput {
  provider: string;
  label: string;
  plaintext: string;
  masterKey: Uint8Array;
}

export function addKey(db: DB, input: KeyInput): KeyRow {
  const sealed: SealedKey = sealApiKey(input.plaintext, input.masterKey);
  const row: KeyRow = {
    id: randomUUID(),
    ownerId: "local",
    provider: input.provider,
    label: input.label,
    ciphertext: b64(sealed.ciphertext),
    nonce: b64(sealed.nonce),
    wrappedDek: b64(sealed.wrappedDek),
    createdAt: Date.now(),
    rotatedAt: null,
  };
  db.insert(keys).values(row).run();
  return row;
}

export function getKey(db: DB, id: string): KeyRow | undefined {
  return db.select().from(keys).where(eq(keys.id, id)).get();
}

export function listKeys(db: DB): KeyRow[] {
  return db.select().from(keys).all();
}

export function sealedFromRow(row: KeyRow): SealedKey {
  return {
    ciphertext: unb64(row.ciphertext),
    nonce: unb64(row.nonce),
    wrappedDek: unb64(row.wrappedDek),
  };
}

export interface GrantInput {
  keyId: string;
  granteeLabel: string;
  granteeType: "agent" | "human";
  scope: unknown;
  spendCapCents?: number;
  expiresAt?: number | null;
}

export interface GrantCreated {
  grant: GrantRow;
  token: string; // shown ONCE, never stored in plaintext
}

export function createGrant(db: DB, input: GrantInput): GrantCreated {
  const token = mintToken();
  const row: GrantRow = {
    id: randomUUID(),
    keyId: input.keyId,
    granteeLabel: input.granteeLabel,
    granteeType: input.granteeType,
    tokenHash: hashToken(token),
    scopeJson: JSON.stringify(input.scope),
    spendCapCents: input.spendCapCents ?? null,
    spentCents: 0,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    createdAt: Date.now(),
  };
  db.insert(grants).values(row).run();
  return { grant: row, token };
}

export function findGrantByToken(db: DB, token: string): GrantRow | undefined {
  return db.select().from(grants).where(eq(grants.tokenHash, hashToken(token))).get();
}

export function listGrants(db: DB): GrantRow[] {
  return db.select().from(grants).all();
}

/** Revoke by grant id or by token. Returns true if a row was revoked. */
export function revokeGrant(db: DB, idOrToken: string): boolean {
  const byToken = idOrToken.startsWith("gv_");
  const where = byToken ? eq(grants.tokenHash, hashToken(idOrToken)) : eq(grants.id, idOrToken);
  const res = db.update(grants).set({ revokedAt: Date.now() }).where(where).run();
  return res.changes > 0;
}

export function addSpend(db: DB, grantId: string, cents: number): void {
  const g = db.select().from(grants).where(eq(grants.id, grantId)).get();
  if (!g) return;
  db.update(grants)
    .set({ spentCents: g.spentCents + cents })
    .where(eq(grants.id, grantId))
    .run();
}

export interface AuditInput {
  grantId: string;
  method: string;
  path: string;
  upstreamStatus?: number;
  bytesIn?: number;
  bytesOut?: number;
  estCostCents?: number;
}

export function writeAudit(db: DB, input: AuditInput): void {
  db.insert(audit)
    .values({
      id: randomUUID(),
      grantId: input.grantId,
      ts: Date.now(),
      method: input.method,
      path: input.path,
      upstreamStatus: input.upstreamStatus ?? null,
      bytesIn: input.bytesIn ?? null,
      bytesOut: input.bytesOut ?? null,
      estCostCents: input.estCostCents ?? null,
    })
    .run();
}

export function listAudit(db: DB, grantId?: string) {
  if (grantId) return db.select().from(audit).where(eq(audit.grantId, grantId)).all();
  return db.select().from(audit).all();
}
