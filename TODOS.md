# TODOS

## Per-grant rate limiting
- **What:** Add a per-grant request-rate limit (e.g. requests/min) enforced in the proxy.
- **Why:** Spend caps bound money, but REST keys (Stripe, etc.) have no per-call cost. A
  leaked grant token could hammer the upstream API, trip the provider's rate limits, or
  cause damage before the grant expires. A rate limit closes that gap.
- **Pros:** Bounds abuse for non-metered APIs; small addition (proxy already does per-grant
  checks); pairs naturally with the spend cap.
- **Cons:** One more column + a token-bucket check on the hot path.
- **Context:** Add `rate_limit` to the `grants` table; enforce in `proxy/` next to the spend
  check. Deny with 429 when exceeded.
- **Depends on:** proxy/ + store/ from v1.

## Key rotation workflow
- **What:** A `keyvault rotate <provider>` flow that swaps the stored upstream key without
  breaking live grants.
- **Why:** Keys get compromised or need routine rotation. Grantees point at grant tokens,
  not the real key, so rotation can be invisible to them if grants keep referencing the
  same `key_id`.
- **Pros:** Zero-downtime rotation for grantees; low effort because grants reference
  `key_id`, not the secret itself.
- **Cons:** Adds CLI surface; need to handle in-flight requests during the swap.
- **Context:** Store new ciphertext under the same `key_id`, update `rotated_at`. Grants
  unchanged. Implement in `cli/`.
- **Depends on:** crypto/ + store/ + cli/ from v1.
