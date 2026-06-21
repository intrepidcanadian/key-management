import { Hono } from "hono";
import type { DB } from "../store/db.js";
import type { KeyWrapper } from "../crypto/wrapper.js";
import { openApiKey } from "../crypto/cipher.js";
import {
  findGrantByToken,
  getKey,
  sealedFromRow,
  writeAudit,
  updateAuditCost,
  addSpend,
} from "../store/repo.js";
import type { DB as Db } from "../store/db.js";
import { getProvider } from "../providers.js";
import { RestMatcher, type RestScope } from "../scope/rest.js";
import { LlmMatcher, checkSpend, type LlmScope } from "../scope/llm.js";
import { accountCost } from "../pricing.js";

const restMatcher = new RestMatcher();
const llmMatcher = new LlmMatcher();

// Hop-by-hop headers we must not forward.
const STRIP = new Set(["host", "connection", "content-length", "authorization"]);

/**
 * Request lifecycle (deny-by-default at every gate):
 *
 *   token → grant? → live? → scope? → spend? → decrypt → forward → audit
 *
 * The real key is decrypted into a local var, used for the upstream call, and never
 * written to a log, the audit row, or the response.
 */
export function createApp(db: DB, wrapper: KeyWrapper): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.all("/:provider/*", async (c) => {
    const providerName = c.req.param("provider");
    const provider = getProvider(providerName);
    if (!provider) return c.json({ error: `unknown provider: ${providerName}` }, 404);

    const token = bearer(c.req.header("authorization"));
    if (!token) return c.json({ error: "missing grant token" }, 401);

    const grant = findGrantByToken(db, token);
    if (!grant) return c.json({ error: "invalid grant token" }, 403);
    if (grant.revokedAt) return c.json({ error: "grant revoked" }, 403);
    if (grant.expiresAt && grant.expiresAt < Date.now())
      return c.json({ error: "grant expired" }, 403);

    const key = getKey(db, grant.keyId);
    if (!key) return c.json({ error: "key not found" }, 500);
    if (key.provider !== providerName)
      return c.json({ error: "grant does not match provider" }, 403);

    const url = new URL(c.req.url);
    const upstreamPath = stripPrefix(url.pathname, `/${providerName}`);
    const method = c.req.method;

    const bodyBuf =
      method === "GET" || method === "HEAD"
        ? undefined
        : new Uint8Array(await c.req.arrayBuffer());

    // ---- scope gate ----
    const scope = JSON.parse(grant.scopeJson);
    const model =
      provider.kind === "llm"
        ? extractModel(bodyBuf, c.req.header("content-type"))
        : undefined;
    if (provider.kind === "llm") {
      const dec = llmMatcher.matches({ method, path: upstreamPath, model }, scope as LlmScope);
      if (!dec.allow) return c.json({ error: `scope denied: ${dec.reason}` }, 403);

      // Soft spend cap: gate on running total before forwarding. The real cost is
      // added after the response is drained (see the tee below).
      const spend = checkSpend(grant.spentCents, 0, grant.spendCapCents ?? undefined);
      if (!spend.allow) return c.json({ error: "spend cap reached" }, 402);
    } else {
      const dec = restMatcher.matches({ method, path: upstreamPath }, scope as RestScope);
      if (!dec.allow) return c.json({ error: `scope denied: ${dec.reason}` }, 403);
    }

    // ---- inject real key (in memory only) ----
    const master = await wrapper.getMasterKey();
    const realKey = openApiKey(sealedFromRow(key), master);

    const headers = new Headers();
    c.req.raw.headers.forEach((v, k) => {
      if (!STRIP.has(k.toLowerCase())) headers.set(k, v);
    });
    headers.set(provider.authHeader, (provider.authScheme ?? "") + realKey);

    let upstream: Response;
    try {
      upstream = await fetch(provider.baseUrl + upstreamPath + url.search, {
        method,
        headers,
        body: bodyBuf,
      });
    } catch (err) {
      writeAudit(db, { grantId: grant.id, method, path: upstreamPath, upstreamStatus: 502 });
      return c.json({ error: "upstream request failed" }, 502);
    }

    // Metadata only — never the body.
    const auditId = writeAudit(db, {
      grantId: grant.id,
      method,
      path: upstreamPath,
      upstreamStatus: upstream.status,
      bytesIn: bodyBuf?.byteLength,
    });

    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete("content-encoding"); // fetch already decoded

    // For LLM calls on a 2xx, tee the stream: one copy goes to the grantee, the
    // other is drained to read `usage` and charge the grant. The grantee is never
    // blocked on accounting. Spend is soft by one in-flight call by design.
    if (provider.kind === "llm" && upstream.body && upstream.ok) {
      const [toClient, toMeter] = upstream.body.tee();
      void meterCost(db, grant.id, auditId, model, toMeter);
      return new Response(toClient, { status: upstream.status, headers: respHeaders });
    }

    // Stream straight back (SSE-safe) for REST and non-2xx.
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  });

  return app;
}

/** Drain the metering branch, compute cost from usage, charge the grant + audit row. */
export async function meterCost(
  db: Db,
  grantId: string,
  auditId: string,
  model: string | undefined,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  try {
    const text = await new Response(stream).text();
    const cents = accountCost(model, text);
    addSpend(db, grantId, cents);
    updateAuditCost(db, auditId, cents);
  } catch {
    // Drain failed (client aborted, etc.): charge the fallback so usage-less calls
    // still cost something, per the eng-review anti-dodge rule.
    addSpend(db, grantId, accountCost(model, ""));
  }
}

function bearer(h: string | undefined): string | null {
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}

function stripPrefix(pathname: string, prefix: string): string {
  let p = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function extractModel(body: Uint8Array | undefined, contentType?: string): string | undefined {
  if (!body || !contentType?.includes("application/json")) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return typeof parsed?.model === "string" ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}
