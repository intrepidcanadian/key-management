import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DB } from "../store/db.js";
import type { KeyWrapper } from "../crypto/wrapper.js";
import {
  addKey,
  listKeys,
  rotateKey,
  getKey,
  createGrant,
  listGrants,
  revokeGrant,
  listAudit,
} from "../store/repo.js";
import type { KeyRow, GrantRow } from "../store/schema.js";
import { PROVIDERS, getProvider } from "../providers.js";

/**
 * Local management API for the dashboard. Binds localhost only and has no auth — it's
 * a single-user local tool (the hosted phase adds auth). It NEVER returns a stored
 * secret: keys are exposed as metadata, grant tokens are returned exactly once at
 * creation and never again.
 */
export function createAdminApp(db: DB, wrapper: KeyWrapper): Hono {
  const app = new Hono();
  app.use("/api/*", cors({ origin: (o) => (o?.startsWith("http://localhost") ? o : "") }));

  app.get("/api/providers", (c) =>
    c.json(Object.values(PROVIDERS).map((p) => ({ name: p.name, kind: p.kind, baseUrl: p.baseUrl }))),
  );

  app.get("/api/keys", (c) => c.json(listKeys(db).map(keyDto)));

  app.post("/api/keys", async (c) => {
    const { provider, label, secret } = await c.req.json<{
      provider?: string;
      label?: string;
      secret?: string;
    }>();
    if (!provider || !getProvider(provider)) return c.json({ error: "unknown provider" }, 400);
    if (!label) return c.json({ error: "label required" }, 400);
    if (!secret) return c.json({ error: "secret required" }, 400);
    const master = await wrapper.getMasterKey();
    const row = addKey(db, { provider, label, plaintext: secret, masterKey: master });
    return c.json(keyDto(row), 201);
  });

  app.post("/api/keys/:id/rotate", async (c) => {
    const { secret } = await c.req.json<{ secret?: string }>();
    if (!secret) return c.json({ error: "secret required" }, 400);
    const master = await wrapper.getMasterKey();
    const ok = rotateKey(db, c.req.param("id"), secret, master);
    return ok ? c.json({ ok: true }) : c.json({ error: "key not found" }, 404);
  });

  app.get("/api/grants", (c) => c.json(listGrants(db).map(grantDto)));

  app.post("/api/grants", async (c) => {
    const b = await c.req.json<{
      keyId?: string;
      granteeLabel?: string;
      granteeType?: string;
      models?: string[];
      allow?: { method: string; path: string }[];
      spendCapCents?: number;
      rateLimitPerMin?: number;
      expiresMs?: number;
    }>();
    if (!b.keyId || !b.granteeLabel) return c.json({ error: "keyId and granteeLabel required" }, 400);
    const key = getKey(db, b.keyId);
    if (!key) return c.json({ error: "key not found" }, 404);
    const provider = getProvider(key.provider)!;

    const scope =
      provider.kind === "llm"
        ? { models: b.models?.length ? b.models : ["*"], ...(b.spendCapCents ? { spendCapCents: b.spendCapCents } : {}) }
        : { rules: b.allow ?? [] };

    const { grant, token } = createGrant(db, {
      keyId: b.keyId,
      granteeLabel: b.granteeLabel,
      granteeType: b.granteeType === "human" ? "human" : "agent",
      scope,
      spendCapCents: b.spendCapCents,
      rateLimitPerMin: b.rateLimitPerMin,
      expiresAt: b.expiresMs ? Date.now() + b.expiresMs : null,
    });
    // token returned ONCE
    return c.json({ grant: grantDto(grant), token, baseUrlHint: `/${key.provider}` }, 201);
  });

  app.post("/api/grants/:id/revoke", (c) => {
    const ok = revokeGrant(db, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "grant not found" }, 404);
  });

  app.get("/api/audit", (c) => {
    const grantId = c.req.query("grantId");
    return c.json(listAudit(db, grantId).slice(-200).reverse());
  });

  return app;
}

function keyDto(k: KeyRow) {
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    createdAt: k.createdAt,
    rotatedAt: k.rotatedAt,
  };
}

function grantState(g: GrantRow): "revoked" | "expired" | "live" {
  if (g.revokedAt) return "revoked";
  if (g.expiresAt && g.expiresAt < Date.now()) return "expired";
  return "live";
}

function grantDto(g: GrantRow) {
  return {
    id: g.id,
    keyId: g.keyId,
    granteeLabel: g.granteeLabel,
    granteeType: g.granteeType,
    state: grantState(g),
    spentCents: g.spentCents,
    spendCapCents: g.spendCapCents,
    rateLimitPerMin: g.rateLimitPerMin,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
    scope: safeParse(g.scopeJson),
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
