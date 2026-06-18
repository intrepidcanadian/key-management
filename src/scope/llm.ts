import {
  type ScopeMatcher,
  type ScopeRequest,
  type ScopeDecision,
  allow,
  deny,
} from "./matcher.js";

/**
 * LLM scope: a model allowlist plus a spend cap.
 *
 * The matcher itself only checks the model allowlist (it's pure — no knowledge of
 * money already spent). Spend enforcement needs DB state, so it lives in a separate
 * pure helper `checkSpend` that the proxy calls with the grant's running total.
 *
 * Spend caps are SOFT by one in-flight request: true cost is only known from the
 * response `usage`, so we gate on the running total before forwarding and add the
 * real cost after. Worst case a grantee overshoots by a single call.
 */
export interface LlmScope {
  models: string[]; // "*" allows any model
  spendCapCents?: number; // omit = unlimited
}

export class LlmMatcher implements ScopeMatcher<LlmScope> {
  readonly kind = "llm" as const;

  matches(req: ScopeRequest, scope: LlmScope): ScopeDecision {
    const model = req.model;
    if (!model) return deny("request did not name a model");
    const list = scope.models ?? [];
    if (list.includes("*") || list.includes(model)) {
      return allow(`model ${model} allowed`);
    }
    return deny(`model ${model} not in allowlist`);
  }
}

export interface SpendDecision extends ScopeDecision {
  remainingCents: number | null; // null = unlimited
}

/**
 * Gate a call against the spend cap using the grant's already-spent total.
 * Called by the proxy BEFORE forwarding (estCostCents may be 0 if unknown).
 */
export function checkSpend(
  spentCents: number,
  estCostCents: number,
  capCents?: number,
): SpendDecision {
  if (capCents === undefined) {
    return { allow: true, reason: "no spend cap", remainingCents: null };
  }
  if (spentCents >= capCents) {
    return { allow: false, reason: "spend cap reached", remainingCents: 0 };
  }
  return {
    allow: true,
    reason: "under spend cap",
    remainingCents: Math.max(0, capCents - spentCents - estCostCents),
  };
}
