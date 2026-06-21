import { describe, it, expect } from "vitest";
import { RateLimiter } from "./ratelimit.js";

describe("RateLimiter (token bucket)", () => {
  it("allows up to the burst, then blocks", () => {
    const rl = new RateLimiter();
    const t = 1000;
    // 3/min: allow 3 immediately, block the 4th (no time elapsed)
    expect(rl.tryConsume("g", 3, t)).toBe(true);
    expect(rl.tryConsume("g", 3, t)).toBe(true);
    expect(rl.tryConsume("g", 3, t)).toBe(true);
    expect(rl.tryConsume("g", 3, t)).toBe(false);
  });

  it("refills over time", () => {
    const rl = new RateLimiter();
    let t = 0;
    expect(rl.tryConsume("g", 60, t)).toBe(true); // 60/min = 1/sec
    // drain the bucket
    for (let i = 0; i < 59; i++) rl.tryConsume("g", 60, t);
    expect(rl.tryConsume("g", 60, t)).toBe(false);
    // advance 1 second → ~1 token back
    t += 1000;
    expect(rl.tryConsume("g", 60, t)).toBe(true);
  });

  it("keeps grants independent", () => {
    const rl = new RateLimiter();
    const t = 0;
    expect(rl.tryConsume("a", 1, t)).toBe(true);
    expect(rl.tryConsume("a", 1, t)).toBe(false);
    expect(rl.tryConsume("b", 1, t)).toBe(true); // b has its own bucket
  });

  it("treats 0 or negative as unlimited", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 100; i++) expect(rl.tryConsume("g", 0, 0)).toBe(true);
  });
});
