import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/semantic-scholar/rate-limiter";

describe("RateLimiter", () => {
  it("fires immediately for the first request", async () => {
    const limiter = new RateLimiter(100);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("enforces minimum gap between requests", async () => {
    const rps = 10; // 100ms interval
    const limiter = new RateLimiter(rps);
    const times: number[] = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      await limiter.acquire();
      times.push(Date.now());
    }
    // Gaps between consecutive fires must each be >= ~90ms (allow 10ms jitter)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(80);
    }
  }, 10000);

  it("total elapsed over 5 requests >= 4 * intervalMs", async () => {
    const intervalMs = 50; // 20 rps
    const limiter = new RateLimiter(1000 / intervalMs);
    const start = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(4 * intervalMs - 20); // 20ms jitter
  }, 10000);

  it("queues concurrent requests and fires them in order", async () => {
    const limiter = new RateLimiter(20); // 50ms
    const order: number[] = [];
    await Promise.all([0, 1, 2].map(async (i) => {
      await limiter.acquire();
      order.push(i);
    }));
    expect(order).toEqual([0, 1, 2]);
  }, 10000);
});
