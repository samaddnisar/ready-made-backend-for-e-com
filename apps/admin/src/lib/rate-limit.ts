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
    // Cheap protection against unbounded growth from spoofed keys.
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) return false;
  bucket.timestamps.push(now);
  return true;
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
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
