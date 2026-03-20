import { LRUCache } from "lru-cache";
import { NextResponse } from "next/server";

type RateLimitOptions = {
  /** Maximum number of requests in the window. */
  limit?: number;
  /** Window duration in milliseconds. */
  windowMs?: number;
};

/**
 * Simple in-memory sliding-window rate limiter backed by LRU cache.
 * Suitable for single-process deployments. For multi-instance production,
 * replace with @upstash/ratelimit + Redis.
 */
export function createRateLimiter({
  limit = 10,
  windowMs = 60_000,
}: RateLimitOptions = {}) {
  const cache = new LRUCache<string, number[]>({
    max: 5000,
    ttl: windowMs,
  });

  return {
    /**
     * Check whether `key` has exceeded the rate limit.
     * Returns a 429 NextResponse if exceeded, or null if within limits.
     */
    check(key: string): NextResponse | null {
      const now = Date.now();
      const timestamps = cache.get(key) ?? [];

      // Remove timestamps outside the current window
      const recent = timestamps.filter((t) => now - t < windowMs);
      recent.push(now);
      cache.set(key, recent);

      if (recent.length > limit) {
        return NextResponse.json(
          { error: "יותר מדי בקשות. נסה שוב מאוחר יותר.", code: "RATE_LIMITED" },
          {
            status: 429,
            headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) },
          }
        );
      }
      return null;
    },
  };
}
