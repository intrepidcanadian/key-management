import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { getTestDb } from "../store/db.js";
import { addKey, createGrant, findGrantByToken, listAudit } from "../store/repo.js";
import { createApp } from "./app.js";
import type { KeyWrapper } from "../crypto/wrapper.js";

/**
 * Live end-to-end test. Drives a REAL request through the proxy to a REAL LLM and
 * asserts the full path: 200 from upstream + usage-based spend charged + per-call cost
 * recorded on the audit row. The tee→meter round trip on a real 200 is otherwise
 * unproven (the offline smoke tests stop at the upstream 401 from a fake key).
 *
 * Skips unless KEYVAULT_E2E_KEY is set, so CI and offline runs are unaffected.
 *
 *   KEYVAULT_E2E_KEY=sk-...                # required to run
 *   KEYVAULT_E2E_PROVIDER=openai|anthropic # default openai
 *   KEYVAULT_E2E_MODEL=...                 # default per provider
 */
const KEY = process.env.KEYVAULT_E2E_KEY;
const PROVIDER = (process.env.KEYVAULT_E2E_PROVIDER ?? "openai") as "openai" | "anthropic";

interface ProviderCall {
  path: string;
  model: string;
  body: (model: string) => unknown;
  headers: Record<string, string>;
}
const CALLS: Record<"openai" | "anthropic", ProviderCall> = {
  openai: {
    path: "/v1/chat/completions",
    model: process.env.KEYVAULT_E2E_MODEL ?? "gpt-4o-mini",
    body: (model) => ({ model, max_tokens: 5, messages: [{ role: "user", content: "say hi" }] }),
    headers: {},
  },
  anthropic: {
    path: "/v1/messages",
    model: process.env.KEYVAULT_E2E_MODEL ?? "claude-3-5-haiku-latest",
    body: (model) => ({ model, max_tokens: 5, messages: [{ role: "user", content: "say hi" }] }),
    headers: { "anthropic-version": "2023-06-01" },
  },
};

const fixedMaster = (k: Uint8Array): KeyWrapper => ({ name: "test", getMasterKey: async () => k });

describe.skipIf(!KEY)("live LLM end-to-end", () => {
  it("forwards a real call, returns 200, and charges usage-based spend", async () => {
    const call = CALLS[PROVIDER];
    const master = new Uint8Array(randomBytes(32));
    const db = getTestDb();
    const key = addKey(db, { provider: PROVIDER, label: "e2e", plaintext: KEY!, masterKey: master });
    const { grant, token } = createGrant(db, {
      keyId: key.id,
      granteeLabel: "e2e",
      granteeType: "agent",
      scope: { models: ["*"] },
      spendCapCents: 100,
    });

    const app = createApp(db, fixedMaster(master));
    const res = await app.request(`/${PROVIDER}${call.path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...call.headers },
      body: JSON.stringify(call.body(call.model)),
    });

    expect(res.status).toBe(200);
    await res.text(); // drain the client copy so the meter branch can complete

    // Spend is metered asynchronously after the stream drains — poll briefly.
    const spent = await waitFor(() => {
      const c = findGrantByToken(db, token)?.spentCents ?? 0;
      return c > 0 ? c : null;
    });
    expect(spent).toBeGreaterThan(0);

    const cost = listAudit(db, grant.id)[0]?.estCostCents ?? 0;
    expect(cost).toBeGreaterThan(0);
  }, 30_000);
});

async function waitFor<T>(fn: () => T | null, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for spend to register");
    await new Promise((r) => setTimeout(r, 50));
  }
}
