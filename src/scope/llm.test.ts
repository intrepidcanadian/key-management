import { describe, it, expect } from "vitest";
import { LlmMatcher, checkSpend, type LlmScope } from "./llm.js";

const m = new LlmMatcher();
const scope: LlmScope = { models: ["claude-opus-4-8", "gpt-5"], spendCapCents: 500 };

describe("LlmMatcher — model allowlist", () => {
  it("allows a listed model", () => {
    expect(m.matches({ method: "POST", path: "/v1/messages", model: "claude-opus-4-8" }, scope).allow).toBe(true);
  });
  it("denies an unlisted model", () => {
    expect(m.matches({ method: "POST", path: "/v1/messages", model: "gpt-4o" }, scope).allow).toBe(false);
  });
  it("denies when no model is named", () => {
    expect(m.matches({ method: "POST", path: "/v1/messages" }, scope).allow).toBe(false);
  });
  it("allows any model with a wildcard", () => {
    expect(m.matches({ method: "POST", path: "/v1/messages", model: "anything" }, { models: ["*"] }).allow).toBe(true);
  });
});

describe("checkSpend — soft cap", () => {
  it("allows when under the cap", () => {
    expect(checkSpend(100, 10, 500).allow).toBe(true);
  });
  it("blocks once the running total reaches the cap", () => {
    expect(checkSpend(500, 0, 500).allow).toBe(false);
    expect(checkSpend(501, 0, 500).allow).toBe(false);
  });
  it("permits one overshoot: at 499 of 500, a 50c call still goes", () => {
    expect(checkSpend(499, 50, 500).allow).toBe(true); // soft cap by one in-flight call
  });
  it("treats an absent cap as unlimited", () => {
    const d = checkSpend(9_999_999, 1000, undefined);
    expect(d.allow).toBe(true);
    expect(d.remainingCents).toBeNull();
  });
});
