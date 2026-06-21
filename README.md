# KeyVault

**One place for all your API keys. Use them in any project by installing an MCP, and revoke access the instant you want it gone.**

KeyVault holds your real API keys, encrypted. Anything that needs a key — an AI agent, a script, another project — gets a scoped, expiring, revocable **grant token** instead of the secret. Requests flow through a local proxy that injects the real key at the last moment. Every call is metered and audited.

> A leaked grant token is a sprained ankle: scoped, expiring, rate-limited, spend-capped, revocable, audited.
> A leaked real key is a severed artery.

---

## Why

You accumulate keys (OpenAI, Anthropic, Qwen, Stripe...) and end up pasting them into `.env` files across a dozen projects. Every copy is a place the key can leak, and you can't take any of them back without rotating the key everywhere.

KeyVault flips that. The key lives in one encrypted place. Each project gets its own grant — "this project may use Qwen, model `qwen-plus`, max 500¢, 10 req/min, for 30 days." Revoke it and that project is cut off in one click, while everything else keeps working.

---

## What works today

Local-first, single-user. 67 tests, all green.

| Area | Status |
|---|---|
| Encrypted vault (XChaCha20-Poly1305 envelope, OS keychain) | ✅ |
| Grant tokens: scope, expiry, **spend cap**, **rate limit**, revoke | ✅ |
| Usage-based spend accounting (OpenAI + Anthropic + Qwen, streaming too) | ✅ |
| Audit log (metadata only — never request/response bodies) | ✅ |
| **Web dashboard** (manage keys + grants, live audit) | ✅ |
| **MCP server** — use your keys in any project (multi-connection) | ✅ |
| Key rotation (`keyvault rotate`, zero-downtime) | ✅ |
| Providers: Qwen (Alibaba), OpenAI, Anthropic, Stripe | ✅ |
| Hosted multi-tenant + non-dev web console | ⏳ deferred (v2) |

---

## Architecture

```
                       ┌──────────────────────────────────────────┐
   you ──manage──────► │ admin API + dashboard   localhost:8788    │
                       └──────────────────────────────────────────┘
                                      │ (same encrypted SQLite vault)
 agent / project ─token─► ┌──────────────────────────────────────┐ ─real key─► UPSTREAM
   (via MCP or HTTP)      │ proxy   localhost:8787                │             (OpenAI,
                          │ token→grant→live?→scope→spend→rate→   │              Qwen, ...)
                          │ decrypt→forward→audit                 │
                          └──────────────────────────────────────┘
```

- **The vault** stores each key encrypted (a per-key data key, wrapped by a master key from your OS keychain).
- **The proxy** is the only thing that ever decrypts a key, in memory, for one forwarded request.
- **Grant tokens** are bearer capabilities, stored hashed. They carry scope, not secrets.

---

## Quickstart

```bash
git clone git@github.com:intrepidcanadian/key-management.git
cd key-management
npm install
npm test                         # 67 tests

# build the dashboard, then run the vault (proxy :8787 + dashboard :8788)
npm --prefix web install
npm --prefix web run build
npm start
# open http://localhost:8788
```

On macOS the master key is created in your Keychain on first use. On Linux/CI, set
`KEYVAULT_MASTER_KEY` to a base64-encoded 32-byte value instead.

---

## Storing keys

**In the dashboard** (`http://localhost:8788`): pick a provider, give it a label, paste
the secret. It's encrypted immediately and never shown again.

**Or via CLI** (secret read from stdin so it stays out of shell history):

```bash
echo -n 'sk-...' | npm run cli -- add-key qwen --label alibaba-qwen
npm run cli -- list
```

---

## Use your keys in any project (MCP)

This is the main workflow. Install the MCP once, point it at grants, and any
MCP-aware tool (Claude Code, Cursor, your own agent) can use your keys — without ever
seeing them.

### 1. Keep the vault running

```bash
npm start      # proxy :8787 must be up for grants to work
```

### 2. Mint a grant for the project (in the dashboard, or CLI)

```bash
npm run cli -- share <keyId> --to my-project --as agent \
  --models 'qwen-plus' --cap 500 --rate 10 --expires 30d
```

It prints a `gv_...` token **once** and a ready-to-paste connection entry.

### 3. Put the grant in your MCP config

`~/.keyvault/mcp.json` (see [`mcp.example.json`](mcp.example.json)):

```json
{
  "connections": {
    "qwen":   { "baseUrl": "http://localhost:8787/qwen",   "token": "gv_..." },
    "openai": { "baseUrl": "http://localhost:8787/openai", "token": "gv_..." }
  }
}
```

One MCP install reaches all connections listed here. Revoke a grant and that
connection stops working everywhere.

### 4. Register the MCP server with your tool

Build once so there's a stable entry point:

```bash
npm run build      # emits dist/mcp/server.js
```

**Claude Code** — `claude mcp add keyvault -- node /abs/path/to/key-management/dist/mcp/server.js`
or in `.mcp.json`:

```json
{
  "mcpServers": {
    "keyvault": { "command": "node", "args": ["/abs/path/to/key-management/dist/mcp/server.js"] }
  }
}
```

**Cursor** — add the same `mcpServers` block to `~/.cursor/mcp.json`.

The server reads `~/.keyvault/mcp.json` automatically. It exposes two tools:

- `list_connections` — what this project can reach
- `request` — make a call: `{ connection: "qwen", path: "/v1/chat/completions", body: { model: "qwen-plus", messages: [...] } }`

The agent gets the response; the key never enters its context.

### Alternative: plain env vars (no MCP)

Any OpenAI-compatible client works by pointing at the proxy:

```bash
OPENAI_BASE_URL=http://localhost:8787/qwen
OPENAI_API_KEY=gv_...        # the grant token, not the real key
```

---

## Security model

- **Keys at rest:** XChaCha20-Poly1305 envelope encryption. Master key from the OS
  keychain (`KeyWrapper` interface; cloud KMS drops in for the hosted phase).
- **Grant tokens:** stored as SHA-256 hashes. A DB leak yields no usable tokens.
- **Every request is bounded:** scope (model allowlist or method+path), expiry, spend
  cap, and rate limit — all enforced in the proxy, deny-by-default.
- **Audit:** records method, path, status, and cost. **Never** request or response
  bodies (no prompts, PII, or payment data on disk).
- **The real key** is decrypted only in memory, only for the forwarded request, and
  never written to a log, the audit row, or any response.
- **The admin API binds localhost** and is single-user (the hosted phase adds auth).

---

## Providers

Built in: `qwen` (Alibaba Model Studio, OpenAI-compatible), `openai`, `anthropic`,
`stripe`. Add one in [`src/providers.ts`](src/providers.ts) — base URL, kind
(`llm` or `rest`), and how the key is injected. For LLM providers, add pricing in
[`src/pricing.ts`](src/pricing.ts) so the spend cap is accurate.

---

## CLI reference

```
keyvault add-key <provider> --label <l> [--key <secret>]   # store (stdin if --key omitted)
keyvault share <keyId> --to <name> --as <agent|human>      # mint a grant
        [--models a,b | --allow "GET /v1/*"] [--cap <cents>] [--rate <n>] [--expires 1h|7d]
keyvault rotate <keyId> [--key <secret>]                   # swap the secret, grants survive
keyvault revoke <grantId|token>                            # kill switch
keyvault list                                              # keys + grants
keyvault audit [grantId]                                   # request history + cost
```

Run as `npm run cli -- <command>`, or `npm run build && npm link` for a global `keyvault`.

---

## Project layout

```
src/
  crypto/     envelope encryption + KeyWrapper (OS keychain / env / KMS-stub)
  scope/      ScopeMatcher: RestMatcher (path) + LlmMatcher (model + spend) — pure
  store/      SQLite + Drizzle; hashed tokens; rotation
  pricing.ts  usage parsing + per-model cost
  ratelimit.ts per-grant token bucket
  proxy/      the request gate chain + spend metering (tee)
  admin/      localhost management API (never returns secrets)
  mcp/        stdio MCP server + multi-connection config
  cli/        keyvault command
  server.ts   runs proxy + admin together
web/          React + Vite dashboard
```

## Testing

```bash
npm test                                   # unit + integration (live LLM test skipped)
KEYVAULT_E2E_KEY=sk-... npm test           # also run the real round-trip test
```

## Roadmap

See [`TODOS.md`](TODOS.md). Next big piece is the hosted phase: multi-tenant auth,
the non-developer web console, Postgres, and cloud KMS — its own design pass before
building.

## License

MIT
