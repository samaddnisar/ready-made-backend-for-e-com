import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import { notFound } from "../errors";
import { paginate, type Paginated } from "../validation/common";
import type { ListMediaQuery } from "../validation/catalog";

export type MediaItem = typeof media.$inferSelect;

export async function listMedia(query: ListMediaQuery): Promise<Paginated<MediaItem>> {
  const db = getDb();
  const filters: SQL[] = [];
  if (query.q) filters.push(ilike(media.filename, `%${query.q}%`));
  if (query.type === "image") filters.push(ilike(media.mimeType, "image/%"));
  if (query.type === "video") filters.push(ilike(media.mimeType, "video/%"));
  if (query.type === "other") {
    filters.push(sql`${media.mimeType} not ilike 'image/%' and ${media.mimeType} not ilike 'video/%'`);
  }

  const where = filters.length ? and(...filters) : undefined;
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(media).where(where);
  const rows = await db
    .select()
    .from(media)
    .where(where)
    .orderBy(desc(media.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export async function createMediaRecord(input: {
  url: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  uploadedBy?: string | null;
}): Promise<MediaItem> {
  const db = getDb();
  const [row] = await db.insert(media).values(input).returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateMediaAlt(id: string, alt: string | null): Promise<MediaItem> {
  const db = getDb();
  const [row] = await db
    .update(media)
    .set({ alt, updatedAt: new Date() })
    .where(eq(media.id, id))
    .returning();
  if (!row) throw notFound("Media not found");
  return row;
}

/** Hard delete the DB record; returns the row so the caller can delete the storage object. */
export async function deleteMediaRecord(id: string): Promise<MediaItem> {
  const db = getDb();
  const [row] = await db.delete(media).where(eq(media.id, id)).returning();
  if (!row) throw notFound("Media not found");
  return row;
}
