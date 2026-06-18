/**
 * A ScopeMatcher decides whether a single request is allowed by a grant's scope.
 *
 * Scope is provider-specific:
 *   - REST providers (Stripe, etc.) scope by HTTP method + URL path.
 *   - LLM providers (OpenAI, Anthropic) scope by model allowlist + spend cap.
 *
 * Matchers are PURE functions — no I/O, no DB, no clock. That is what lets us throw
 * hundreds of adversarial inputs at them in milliseconds. Anything stateful (spend
 * already incurred, expiry) is checked by the caller, not here.
 *
 * IRON RULE: deny by default. Anything not explicitly allowed is denied.
 */

export interface ScopeRequest {
  method: string;
  /** Requested path, exactly as received (may contain `..`, `%2e`, `//`, query). */
  path: string;
  /** For LLM requests: the model named in the body. */
  model?: string;
}

export interface ScopeDecision {
  allow: boolean;
  reason: string;
}

export interface ScopeMatcher<S = unknown> {
  readonly kind: "rest" | "llm";
  matches(req: ScopeRequest, scope: S): ScopeDecision;
}

export const deny = (reason: string): ScopeDecision => ({ allow: false, reason });
export const allow = (reason = "ok"): ScopeDecision => ({ allow: true, reason });
