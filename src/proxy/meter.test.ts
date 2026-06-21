import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { getTestDb } from "../store/db.js";
import { addKey, createGrant, writeAudit, findGrantByToken, listAudit } from "../store/repo.js";
import { meterCost } from "./app.js";

const master = () => new Uint8Array(randomBytes(32));

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function seedGrant(spendCapCents?: number) {
  const db = getTestDb();
  const key = addKey(db, { provider: "openai", label: "t", plaintext: "sk-x", masterKey: master() });
  const { grant, token } = createGrant(db, {
    keyId: key.id,
    granteeLabel: "bot",
    granteeType: "agent",
    scope: { models: ["gpt-5"] },
    spendCapCents,
  });
  const auditId = writeAudit(db, { grantId: grant.id, method: "POST", path: "/v1/chat/completions" });
  return { db, grant, token, auditId };
}

describe("meterCost", () => {
  it("charges real cost from usage and records it on the audit row", async () => {
    const { db, token, grant, auditId } = seedGrant();
    const body = JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 1000 } });
    await meterCost(db, grant.id, auditId, "gpt-5", streamOf(body));

    // gpt-5: 1k in (0.125) + 1k out (1.0) = 1.125c
    expect(findGrantByToken(db, token)?.spentCents).toBeCloseTo(1.125);
    const row = listAudit(db, grant.id).find((a) => a.id === auditId);
    expect(row?.estCostCents).toBeCloseTo(1.125);
  });

  it("charges the fallback (not zero) when usage is missing", async () => {
    const { db, token, grant, auditId } = seedGrant();
    await meterCost(db, grant.id, auditId, "gpt-5", streamOf('data: {"choices":[]}\n'));
    expect(findGrantByToken(db, token)?.spentCents).toBeGreaterThan(0);
  });

  it("accumulates across calls toward the cap", async () => {
    const { db, token, grant, auditId } = seedGrant(500);
    const body = JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 0 } }); // 0.125c
    await meterCost(db, grant.id, auditId, "gpt-5", streamOf(body));
    await meterCost(db, grant.id, auditId, "gpt-5", streamOf(body));
    expect(findGrantByToken(db, token)?.spentCents).toBeCloseTo(0.25);
  });
});
