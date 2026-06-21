# KeyVault

Revocable, shareable API-key access for agents and humans.

Hand an agent or a person *capability*, not your *credential*. The vault holds your
real API keys, encrypted. Grantees send requests through a local proxy authenticated
with a scoped, expiring **grant token** — the vault injects the real key at the last
moment. Revoke = one command, and their next request bounces. Every call is audited.

> A leaked grant token is a sprained ankle (scoped, expiring, revocable, audited).
> A leaked real key is a severed artery.

## Status: v1 scaffold (local-first)

Built and tested (54 tests):
- **`crypto/`** — envelope encryption (XChaCha20-Poly1305), master key from the OS keychain.
- **`scope/`** — per-provider scope matchers: REST (method + path, normalization-hardened)
  and LLM (model allowlist + spend cap). Pure functions, heavily tested.
- **`store/`** — SQLite + Drizzle; grant tokens stored hashed.
- **`proxy/`** — Hono proxy: token → grant → live? → scope → spend → decrypt → forward → audit.
- **`pricing/`** — usage-based spend accounting (OpenAI + Anthropic, streaming + not);
  the spend cap is enforced and charged. Usage-less calls charge a fallback, never 0.
- **`ratelimit/`** — per-grant token-bucket rate limiting (bounds a leaked token on
  no-cost APIs); `--rate` on share.
- **`cli/`** — `add-key`, `share`, `rotate`, `revoke`, `list`, `audit`.
- **`mcp/`** — agent surface: a stdio MCP server that's a thin client of the proxy.

Deferred: hosted multi-tenant + non-dev web console, cloud KMS (`KmsWrapper`),
shared rate-limit state for multi-instance, live-LLM e2e test. See the design doc and `TODOS.md`.

## Quickstart

```bash
npm install
npm test                      # crypto + scope + store tests

# store a key (encrypted at rest); reads the secret from stdin
echo -n 'sk-...' | npm run cli -- add-key openai --label personal

npm run cli -- list           # find the key id
npm run cli -- share <keyId> --to alice --as human --models 'gpt-5' --cap 500 --expires 1h
# prints a grant token (once) + base url

npm run proxy                 # start the proxy on :8787

# alice uses it — never sees the real key:
#   OPENAI_BASE_URL=http://localhost:8787/openai  OPENAI_API_KEY=<grant token>

npm run cli -- revoke <grantId|token>   # kill switch
npm run cli -- audit <grantId>          # what they did (with per-call cost)

echo -n 'sk-new' | npm run cli -- rotate <keyId>   # swap the secret, grants keep working
```

Add `--rate <n>` to `share` to cap a grant at N requests/minute.

### Agent access (MCP)

Share a key `--as agent`, then point an MCP client at the server. The agent calls a
`request` tool and never sees the key or the token:

```bash
npm run cli -- share <keyId> --to my-bot --as agent --models 'claude-opus-4-8' --cap 1000
KEYVAULT_BASE_URL=http://localhost:8787/anthropic \
KEYVAULT_GRANT_TOKEN=<grant token> \
npm run mcp        # stdio MCP server exposing the `request` tool
```

Master key: on macOS it lives in the Keychain (created on first use). Elsewhere, set
`KEYVAULT_MASTER_KEY` to a base64 32-byte key.

## Architecture

```
GRANTEE ──token──> PROXY ──real key──> UPSTREAM API
                     │
        token → grant? → live? → scope? → spend? → decrypt → forward → audit
```

See `~/.gstack/projects/agentinfra/*-design-*.md` for the full design + eng-review decisions.
