export interface Provider {
  name: string;
  kind: "rest" | "llm";
  baseUrl: string;
}

export interface Key {
  id: string;
  provider: string;
  label: string;
  createdAt: number;
  rotatedAt: number | null;
}

export interface Grant {
  id: string;
  keyId: string;
  granteeLabel: string;
  granteeType: "agent" | "human";
  state: "live" | "revoked" | "expired";
  spentCents: number;
  spendCapCents: number | null;
  rateLimitPerMin: number | null;
  expiresAt: number | null;
  createdAt: number;
  scope: unknown;
}

export interface AuditRow {
  id: string;
  grantId: string;
  ts: number;
  method: string;
  path: string;
  upstreamStatus: number | null;
  estCostCents: number | null;
}

export interface NewGrant {
  keyId: string;
  granteeLabel: string;
  granteeType: "agent" | "human";
  models?: string[];
  allow?: { method: string; path: string }[];
  spendCapCents?: number;
  rateLimitPerMin?: number;
  expiresMs?: number;
}

export interface GrantCreated {
  grant: Grant;
  token: string;
  baseUrlHint: string;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  providers: () => fetch("/api/providers").then(j<Provider[]>),
  keys: () => fetch("/api/keys").then(j<Key[]>),
  addKey: (provider: string, label: string, secret: string) =>
    fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, label, secret }),
    }).then(j<Key>),
  rotateKey: (id: string, secret: string) =>
    fetch(`/api/keys/${id}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    }).then(j<{ ok: true }>),
  grants: () => fetch("/api/grants").then(j<Grant[]>),
  createGrant: (g: NewGrant) =>
    fetch("/api/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(g),
    }).then(j<GrantCreated>),
  revokeGrant: (id: string) =>
    fetch(`/api/grants/${id}/revoke`, { method: "POST" }).then(j<{ ok: true }>),
  audit: (grantId?: string) =>
    fetch("/api/audit" + (grantId ? `?grantId=${grantId}` : "")).then(j<AuditRow[]>),
};

// The proxy (where grantees send requests) runs on a different port than the admin UI.
export const PROXY_ORIGIN = `${location.protocol}//${location.hostname}:8787`;
