import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { getTestDb } from "./db.js";
import {
  addKey,
  createGrant,
  findGrantByToken,
  revokeGrant,
  addSpend,
  hashToken,
} from "./repo.js";

const master = () => new Uint8Array(randomBytes(32));

function seed() {
  const db = getTestDb();
  const key = addKey(db, {
    provider: "openai",
    label: "test",
    plaintext: "sk-real-secret",
    masterKey: master(),
  });
  return { db, key };
}

describe("store/repo", () => {
  it("stores grant tokens hashed, never in plaintext", () => {
    const { db, key } = seed();
    const { grant, token } = createGrant(db, {
      keyId: key.id,
      granteeLabel: "alice",
      granteeType: "human",
      scope: { models: ["*"] },
    });
    expect(grant.tokenHash).toBe(hashToken(token));
    expect(grant.tokenHash).not.toBe(token);
    // The raw token is never persisted on the row.
    expect(JSON.stringify(grant)).not.toContain(token);
  });

  it("finds a grant by its token", () => {
    const { db, key } = seed();
    const { token } = createGrant(db, {
      keyId: key.id,
      granteeLabel: "bot",
      granteeType: "agent",
      scope: { models: ["*"] },
    });
    expect(findGrantByToken(db, token)).toBeDefined();
    expect(findGrantByToken(db, "gv_wrong")).toBeUndefined();
  });

  it("revokes by token and by id", () => {
    const { db, key } = seed();
    const { grant, token } = createGrant(db, {
      keyId: key.id,
      granteeLabel: "x",
      granteeType: "human",
      scope: {},
    });
    expect(revokeGrant(db, token)).toBe(true);
    expect(findGrantByToken(db, token)?.revokedAt).toBeTypeOf("number");
    expect(revokeGrant(db, grant.id)).toBe(true);
  });

  it("accumulates spend", () => {
    const { db, key } = seed();
    const { grant, token } = createGrant(db, {
      keyId: key.id,
      granteeLabel: "x",
      granteeType: "human",
      scope: {},
      spendCapCents: 100,
    });
    addSpend(db, grant.id, 30);
    addSpend(db, grant.id, 25);
    expect(findGrantByToken(db, token)?.spentCents).toBe(55);
  });
});
