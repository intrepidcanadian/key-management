/**
 * Turn an LLM response into a cost, so the spend cap actually bites.
 *
 * Cost is only knowable from the response `usage`, which differs by provider and by
 * streaming mode. We parse both. When usage can't be determined (aborted stream,
 * unknown shape), we charge FALLBACK_CALL_CENTS rather than 0 — otherwise a grantee
 * could loop usage-less calls to dodge the cap (the eng-review tripwire).
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Cents per 1K tokens. Approximate, edit per your contracts. */
export interface Rate {
  inPer1k: number;
  outPer1k: number;
}

export const PRICING: Record<string, Rate> = {
  "gpt-5": { inPer1k: 0.125, outPer1k: 1.0 },
  "gpt-4o": { inPer1k: 0.25, outPer1k: 1.0 },
  "claude-opus-4-8": { inPer1k: 0.5, outPer1k: 2.5 },
  "claude-sonnet-4-6": { inPer1k: 0.3, outPer1k: 1.5 },
  // Qwen (Alibaba) — approximate; edit per your contract.
  "qwen-plus": { inPer1k: 0.04, outPer1k: 0.12 },
  "qwen-max": { inPer1k: 0.16, outPer1k: 0.64 },
  "qwen-turbo": { inPer1k: 0.005, outPer1k: 0.02 },
};

/** Charged when an LLM call completes but usage can't be parsed. Never 0. */
export const FALLBACK_CALL_CENTS = 0.1;

export function costCents(model: string | undefined, usage: Usage): number {
  const rate = model ? PRICING[model] : undefined;
  if (!rate) return FALLBACK_CALL_CENTS;
  return (
    (usage.inputTokens / 1000) * rate.inPer1k + (usage.outputTokens / 1000) * rate.outPer1k
  );
}

/** Normalize OpenAI / Anthropic usage objects into a common shape. */
export function normalizeUsage(u: unknown): Usage | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const input = num(o.prompt_tokens) ?? num(o.input_tokens);
  const output = num(o.completion_tokens) ?? num(o.output_tokens);
  if (input === undefined && output === undefined) return null;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/**
 * Extract usage from a full response body (streaming SSE or single JSON).
 * Merges input/output across events (Anthropic splits them across message_start
 * and message_delta), taking the max seen for each so partial chunks don't undercount.
 */
export function extractUsage(body: string): Usage | null {
  // Single JSON (non-streaming).
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const direct = normalizeUsage(j.usage);
    if (direct) return direct;
  } catch {
    // not a single JSON document — fall through to SSE scan
  }

  let input = 0;
  let output = 0;
  let found = false;
  for (const line of body.split("\n")) {
    const trimmed = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!trimmed || trimmed === "[DONE]" || trimmed[0] !== "{") continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const u =
        normalizeUsage(obj.usage) ??
        normalizeUsage((obj.message as Record<string, unknown> | undefined)?.usage) ??
        normalizeUsage(obj.delta);
      if (u) {
        input = Math.max(input, u.inputTokens);
        output = Math.max(output, u.outputTokens);
        found = true;
      }
    } catch {
      // skip non-JSON data lines
    }
  }
  return found ? { inputTokens: input, outputTokens: output } : null;
}

/** Cost for an LLM response body. Falls back (never 0) when usage is missing. */
export function accountCost(model: string | undefined, body: string): number {
  const usage = extractUsage(body);
  return usage ? costCents(model, usage) : FALLBACK_CALL_CENTS;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
