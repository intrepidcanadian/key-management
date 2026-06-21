import { describe, it, expect } from "vitest";
import {
  normalizeUsage,
  extractUsage,
  costCents,
  accountCost,
  FALLBACK_CALL_CENTS,
} from "./pricing.js";

describe("normalizeUsage", () => {
  it("reads OpenAI shape", () => {
    expect(normalizeUsage({ prompt_tokens: 100, completion_tokens: 50 })).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    });
  });
  it("reads Anthropic shape", () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
    });
  });
  it("returns null for junk", () => {
    expect(normalizeUsage({ foo: 1 })).toBeNull();
    expect(normalizeUsage(null)).toBeNull();
  });
});

describe("extractUsage", () => {
  it("parses non-streaming JSON", () => {
    const body = JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 500 } });
    expect(extractUsage(body)).toEqual({ inputTokens: 1000, outputTokens: 500 });
  });
  it("parses OpenAI SSE with a final usage chunk", () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}',
      "data: [DONE]",
      "",
    ].join("\n");
    expect(extractUsage(body)).toEqual({ inputTokens: 12, outputTokens: 8 });
  });
  it("merges Anthropic message_start + message_delta usage", () => {
    const body = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":40,"output_tokens":1}}}',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":77}}',
      "",
    ].join("\n");
    expect(extractUsage(body)).toEqual({ inputTokens: 40, outputTokens: 77 });
  });
  it("returns null when there is no usage", () => {
    expect(extractUsage('data: {"choices":[{"delta":{"content":"x"}}]}')).toBeNull();
  });
});

describe("costCents", () => {
  it("prices a known model", () => {
    // gpt-5: 0.125/1k in, 1.0/1k out → 1k in + 1k out = 0.125 + 1.0 = 1.125c
    expect(costCents("gpt-5", { inputTokens: 1000, outputTokens: 1000 })).toBeCloseTo(1.125);
  });
  it("falls back for an unknown model (never 0)", () => {
    expect(costCents("mystery", { inputTokens: 1000, outputTokens: 1000 })).toBe(FALLBACK_CALL_CENTS);
  });
});

describe("accountCost — fail toward an estimate, not zero", () => {
  it("charges the fallback when usage is missing (anti-dodge)", () => {
    expect(accountCost("gpt-5", "data: {}\n")).toBe(FALLBACK_CALL_CENTS);
  });
  it("charges real cost when usage is present", () => {
    const body = JSON.stringify({ usage: { prompt_tokens: 2000, completion_tokens: 0 } });
    expect(accountCost("gpt-5", body)).toBeCloseTo(0.25);
  });
});
