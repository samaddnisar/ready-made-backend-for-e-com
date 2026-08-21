import "server-only";

import type { NextRequest } from "next/server";
import { getDb, schema } from "@repo/core";
import type { AdminContext } from "./auth";

/**
 * Full audit log of admin mutations (§9). Call from every admin route
 * that changes state. Failures are logged but never break the mutation.
 */
export async function writeAudit(opts: {
  admin: AdminContext;
  action: string;
  resource: string;
  resourceId?: string;
  diff?: { before?: unknown; after?: unknown };
  req?: NextRequest;
}): Promise<void> {
  try {
    const ip =
      opts.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      opts.req?.headers.get("x-real-ip") ??
      null;
    await getDb()
      .insert(schema.auditLog)
      .values({
        adminUserId: opts.admin.adminUser.id,
        action: opts.action,
        resource: opts.resource,
        resourceId: opts.resourceId,
        diff: opts.diff,
        ip,
      });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}
