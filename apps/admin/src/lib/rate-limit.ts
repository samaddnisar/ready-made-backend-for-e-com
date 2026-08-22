import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { AppError } from "@repo/core";
import { fail } from "./api";

/**
 * Sliding-window rate limiter for public + auth-adjacent endpoints (§9).
 *
 * In-memory and therefore PER-INSTANCE: on serverless this still blunts
 * bursts and abuse from a single client hitting a warm instance, which is
 * the §9 goal for a boilerplate. For hard multi-instance guarantees swap
 * `consume` for a Redis/Upstash implementation — the call sites don't change.
 */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function consume(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    // Bound memory without resetting everyone: evict the oldest-inserted
    // tenth (Map preserves insertion order). A full clear() would let an
    // attacker flush every live limit by spraying unique keys.
    if (buckets.size >= MAX_BUCKETS) {
      let evicted = 0;
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (++evicted >= MAX_BUCKETS / 10) break;
      }
    }
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) return false;
  bucket.timestamps.push(now);
  return true;
}

export function clientIp(req: NextRequest): string {
  // x-real-ip is set authoritatively by the platform (Vercel). The LEFTMOST
  // x-forwarded-for entry is client-supplied when the client sends its own
  // header, so as a fallback take the LAST entry — appended by the proxy.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1]!.trim();
  }
  return "unknown";
}

type Handler = (req: NextRequest, ctx: never) => Promise<NextResponse>;

/**
 * Compose OUTSIDE the api wrapper (like withFeature):
 *   export const POST = withRateLimit("checkout", 10, 60_000, withPublicApi(...))
 */
export function withRateLimit<H extends Handler>(
  id: string,
  limit: number,
  windowMs: number,
  handler: H,
): H {
  return (async (req: NextRequest, ctx: never) => {
    if (!consume(`${id}:${clientIp(req)}`, limit, windowMs)) {
      return fail(
        new AppError("rate_limited", "Too many requests — slow down and try again shortly"),
      );
    }
    return handler(req, ctx);
  }) as H;
}
