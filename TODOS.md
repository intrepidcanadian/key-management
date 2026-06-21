# TODOS

## Done
- ~~Spend accounting~~ — usage parsing + per-call cost, cap enforced (`pricing.ts`, proxy tee).
- ~~Per-grant rate limiting~~ — token bucket in the proxy, `--rate` on share (`ratelimit.ts`).
- ~~Key rotation~~ — `keyvault rotate <keyId>`, zero-downtime (`rotateKey` in `store/repo.ts`).

## Hosted phase (v2 — needs its own design pass)
- **What:** Deploy as an always-on multi-tenant service so non-developers can use a
  shared key through a web console.
- **Why:** This is the only way non-devs get value; it's the deferred half of the vision.
- **Pieces:** Postgres (replace SQLite; the per-request audit + spend writes are the
  first bottleneck), `KmsWrapper` (master key never resident in the process), auth +
  accounts (login, sessions), the LLM chat console for non-devs.
- **Context:** Schema already carries `owner_id`; crypto already behind `KeyWrapper`.
  So this is additive, but large. Treat as a multi-session effort.

## Shared rate-limit state
- **What:** Move the rate limiter off in-memory (per-process) to shared storage (Redis).
- **Why:** The current `RateLimiter` is per-process — correct for the local single
  proxy, but a hosted multi-instance deploy would let each instance grant the full
  burst. Needed only once hosted + horizontally scaled.
- **Depends on:** Hosted phase.

## Live LLM end-to-end test
- **What:** A test that sends a real request through the proxy to a real LLM and asserts
  the 2xx + usage-based spend increment.
- **Why:** Current smoke tests use a fake key and stop at the upstream 401; `meterCost`
  is unit-tested but the full tee→meter round trip on a real 200 is untested.
- **Context:** Gate behind an env var holding a throwaway key so CI can skip it.
