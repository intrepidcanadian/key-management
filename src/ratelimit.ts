/**
 * Per-grant rate limiting — the other half of bounding a leaked token. Spend caps
 * protect money; rate limits protect APIs with no per-call cost (Stripe, etc.) from
 * a stolen grant token hammering them before it expires.
 *
 * Token bucket: capacity = requests/min (the allowed burst), refilling continuously.
 * State is in-memory and per-process — fine for the local single-process proxy. The
 * hosted phase will need shared state (Redis); flagged in TODOS.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();

  /**
   * @param now injectable clock (ms) for tests; defaults to Date.now().
   * @returns true if allowed (a token was consumed), false if rate-limited.
   */
  tryConsume(key: string, perMinute: number, now: number = Date.now()): boolean {
    if (perMinute <= 0) return true; // 0 / negative = unlimited
    const refillPerMs = perMinute / 60_000;

    const b = this.buckets.get(key) ?? { tokens: perMinute, last: now };
    // Refill based on elapsed time, capped at capacity.
    const refilled = Math.min(perMinute, b.tokens + (now - b.last) * refillPerMs);

    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, last: now });
      return false;
    }
    this.buckets.set(key, { tokens: refilled - 1, last: now });
    return true;
  }

  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }
}
