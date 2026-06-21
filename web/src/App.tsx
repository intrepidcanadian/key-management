import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  PROXY_ORIGIN,
  type Key,
  type Grant,
  type Provider,
  type AuditRow,
  type GrantCreated,
} from "./api.js";

export function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [created, setCreated] = useState<GrantCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [p, k, g, a] = await Promise.all([
        api.providers(),
        api.keys(),
        api.grants(),
        api.audit(),
      ]);
      setProviders(p);
      setKeys(k);
      setGrants(g);
      setAudit(a);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const kindOf = (provider: string) => providers.find((p) => p.name === provider)?.kind ?? "llm";

  return (
    <div className="wrap">
      <header className="top">
        <h1>KeyVault</h1>
        <span className="tag">revocable, shareable API-key access</span>
      </header>
      <p className="sub">
        Grantees get a capability, never your key. Proxy on{" "}
        <span className="mono">{PROXY_ORIGIN}</span>
      </p>

      {error && <div className="panel error">⚠ {error}</div>}

      {created && <TokenReveal created={created} onClose={() => setCreated(null)} />}

      <Panel title="Keys" count={keys.length}>
        <AddKeyForm
          providers={providers}
          onDone={async (provider, label, secret) => {
            await api.addKey(provider, label, secret);
            await refresh();
          }}
        />
        <KeysTable
          keys={keys}
          onRotate={async (id) => {
            const secret = window.prompt("New secret for this key:");
            if (!secret) return;
            await api.rotateKey(id, secret.trim());
            await refresh();
          }}
        />
      </Panel>

      <Panel title="Grants" count={grants.length}>
        <CreateGrantForm
          keys={keys}
          kindOf={kindOf}
          onDone={async (g) => {
            const res = await api.createGrant(g);
            setCreated(res);
            await refresh();
          }}
        />
        <GrantsTable
          grants={grants}
          keys={keys}
          onRevoke={async (id) => {
            await api.revokeGrant(id);
            await refresh();
          }}
        />
      </Panel>

      <Panel title="Recent requests" count={audit.length}>
        <AuditTable audit={audit} grants={grants} />
      </Panel>
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>
        {title} <span className="count">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function AddKeyForm({
  providers,
  onDone,
}: {
  providers: Provider[];
  onDone: (provider: string, label: string, secret: string) => Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!provider && providers[0]) setProvider(providers[0].name);
  }, [providers, provider]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onDone(provider, label.trim(), secret.trim());
      setLabel("");
      setSecret("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit} style={{ marginBottom: 18 }}>
      <div>
        <label>Provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.kind})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. alibaba-qwen" required />
      </div>
      <div style={{ gridColumn: "span 2" }}>
        <label>Secret (stored encrypted, never shown again)</label>
        <input
          className="mono"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="sk-..."
          required
        />
      </div>
      <div>
        <button disabled={busy || !provider}>{busy ? "Adding…" : "Add key"}</button>
        {err && <div className="error">{err}</div>}
      </div>
    </form>
  );
}

function KeysTable({ keys, onRotate }: { keys: Key[]; onRotate: (id: string) => void }) {
  if (!keys.length) return <div className="empty">No keys yet. Add one above.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Label</th>
          <th>Added</th>
          <th>Rotated</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.id}>
            <td><span className="badge kind">{k.provider}</span></td>
            <td>{k.label}</td>
            <td className="muted">{timeAgo(k.createdAt)}</td>
            <td className="muted">{k.rotatedAt ? timeAgo(k.rotatedAt) : "—"}</td>
            <td style={{ textAlign: "right" }}>
              <button className="ghost" onClick={() => onRotate(k.id)}>Rotate</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CreateGrantForm({
  keys,
  kindOf,
  onDone,
}: {
  keys: Key[];
  kindOf: (provider: string) => "rest" | "llm";
  onDone: (g: import("./api.js").NewGrant) => Promise<void>;
}) {
  const [keyId, setKeyId] = useState("");
  const [granteeLabel, setGranteeLabel] = useState("");
  const [granteeType, setGranteeType] = useState<"agent" | "human">("agent");
  const [models, setModels] = useState("*");
  const [allow, setAllow] = useState("GET /v1/*");
  const [cap, setCap] = useState("");
  const [rate, setRate] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!keyId && keys[0]) setKeyId(keys[0].id);
  }, [keys, keyId]);

  const selected = keys.find((k) => k.id === keyId);
  const kind = selected ? kindOf(selected.provider) : "llm";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onDone({
        keyId,
        granteeLabel: granteeLabel.trim(),
        granteeType,
        models: kind === "llm" ? models.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        allow: kind === "rest" ? parseAllow(allow) : undefined,
        spendCapCents: cap ? Number(cap) : undefined,
        rateLimitPerMin: rate ? Number(rate) : undefined,
        expiresMs: expires ? parseDuration(expires) : undefined,
      });
      setGranteeLabel("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!keys.length) return <div className="empty">Add a key first, then you can share it.</div>;

  return (
    <form className="form-grid" onSubmit={submit} style={{ marginBottom: 18 }}>
      <div>
        <label>Key</label>
        <select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.provider} / {k.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>Grantee</label>
        <input value={granteeLabel} onChange={(e) => setGranteeLabel(e.target.value)} placeholder="alice / my-bot" required />
      </div>
      <div>
        <label>Type</label>
        <select value={granteeType} onChange={(e) => setGranteeType(e.target.value as "agent" | "human")}>
          <option value="agent">agent</option>
          <option value="human">human</option>
        </select>
      </div>
      {kind === "llm" ? (
        <div>
          <label>Models (comma, or *)</label>
          <input value={models} onChange={(e) => setModels(e.target.value)} placeholder="qwen-plus" />
        </div>
      ) : (
        <div style={{ gridColumn: "span 2" }}>
          <label>Allow rules (one per line: METHOD /path/*)</label>
          <input value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="GET /v1/charges/*" />
        </div>
      )}
      <div>
        <label>Spend cap (cents)</label>
        <input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="∞" inputMode="numeric" />
      </div>
      <div>
        <label>Rate (req/min)</label>
        <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="∞" inputMode="numeric" />
      </div>
      <div>
        <label>Expires</label>
        <input value={expires} onChange={(e) => setExpires(e.target.value)} placeholder="1h / 30m / 7d" />
      </div>
      <div>
        <button disabled={busy || !keyId}>{busy ? "Creating…" : "Create grant"}</button>
        {err && <div className="error">{err}</div>}
      </div>
    </form>
  );
}

function GrantsTable({
  grants,
  keys,
  onRevoke,
}: {
  grants: Grant[];
  keys: Key[];
  onRevoke: (id: string) => void;
}) {
  if (!grants.length) return <div className="empty">No grants yet.</div>;
  const keyLabel = (id: string) => {
    const k = keys.find((x) => x.id === id);
    return k ? `${k.provider}/${k.label}` : id.slice(0, 8);
  };
  return (
    <table>
      <thead>
        <tr>
          <th>Grantee</th>
          <th>Key</th>
          <th>State</th>
          <th>Spend</th>
          <th>Rate</th>
          <th>Expires</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {grants.map((g) => (
          <tr key={g.id}>
            <td>
              {g.granteeLabel} <span className="badge kind">{g.granteeType}</span>
            </td>
            <td className="muted">{keyLabel(g.keyId)}</td>
            <td><span className={`badge ${g.state}`}>{g.state}</span></td>
            <td><SpendCell spent={g.spentCents} cap={g.spendCapCents} /></td>
            <td className="muted">{g.rateLimitPerMin ? `${g.rateLimitPerMin}/min` : "∞"}</td>
            <td className="muted">{expiresLabel(g.expiresAt)}</td>
            <td style={{ textAlign: "right" }}>
              {g.state === "live" && (
                <button className="danger" onClick={() => onRevoke(g.id)}>Revoke</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpendCell({ spent, cap }: { spent: number; cap: number | null }) {
  const label = `${spent.toFixed(spent < 1 ? 4 : 2)}¢` + (cap ? ` / ${cap}¢` : "");
  if (!cap) return <span className="muted">{label}</span>;
  const pct = Math.min(100, (spent / cap) * 100);
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, marginBottom: 3 }}>{label}</div>
      <div className="bar"><div className={pct >= 100 ? "over" : ""} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function AuditTable({ audit, grants }: { audit: AuditRow[]; grants: Grant[] }) {
  if (!audit.length) return <div className="empty">No requests yet. Use a grant token against the proxy.</div>;
  const grantee = (id: string) => grants.find((g) => g.id === id)?.granteeLabel ?? id.slice(0, 8);
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Grantee</th>
          <th>Request</th>
          <th>Status</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {audit.map((a) => (
          <tr key={a.id}>
            <td className="muted">{timeAgo(a.ts)}</td>
            <td>{grantee(a.grantId)}</td>
            <td className="mono">{a.method} {a.path}</td>
            <td className={a.upstreamStatus && a.upstreamStatus < 400 ? "status-ok" : "status-bad"}>
              {a.upstreamStatus ?? "—"}
            </td>
            <td className="muted">{a.estCostCents != null ? `${a.estCostCents.toFixed(4)}¢` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TokenReveal({ created, onClose }: { created: GrantCreated; onClose: () => void }) {
  const base = PROXY_ORIGIN + created.baseUrlHint;
  return (
    <div className="token-reveal">
      <h3>Grant created for "{created.grant.granteeLabel}"</h3>
      <div className="warn-line">Copy the token now — it is shown only once and never stored in plaintext.</div>
      <CodeBox label="token" value={created.token} />
      <CodeBox label="base url" value={base} />
      <CodeBox label="example" value={`OPENAI_BASE_URL=${base}  OPENAI_API_KEY=${created.token}`} />
      <div className="row" style={{ marginTop: 10 }}>
        <div className="spacer" />
        <button className="ghost" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function CodeBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codebox">
      <span><span className="muted">{label}: </span>{value}</span>
      <button
        className="copy"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function expiresLabel(ts: number | null): string {
  if (!ts) return "∞";
  const s = Math.floor((ts - Date.now()) / 1000);
  if (s <= 0) return "expired";
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

function parseDuration(s: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`bad duration: ${s} (use 30m, 1h, 7d)`);
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
  return Number(m[1]) * mult;
}

function parseAllow(text: string): { method: string; path: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [method, path] = l.split(/\s+/, 2);
      if (!method || !path) throw new Error(`bad rule: "${l}"`);
      return { method, path };
    });
}
