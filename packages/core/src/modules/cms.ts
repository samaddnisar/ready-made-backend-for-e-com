import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client";
import { blogPosts, cmsPages } from "../db/schema";
import { notFound } from "../errors";
import { slugify, uniqueSlug } from "../utils/slug";
import { paginate, paginationQuerySchema, slugSchema, type Paginated } from "../validation/common";

/**
 * CMS / Blog module (feature: "cms", §4 toggleable modules).
 * Self-contained: zod schemas + service functions + exported types.
 * Both tables soft-delete; their slug unique indexes are partial
 * (`where deleted_at is null`) so a deleted page/post frees its slug.
 */

// ── Schemas ──────────────────────────────────────────────────

// http(s) only — these URLs render on public storefronts (§9 XSS defense).
const httpUrlSchema = z.url({ protocol: /^https?$/ });

const seoFields = {
  metaTitle: z.string().max(200).nullable().optional(),
  metaDescription: z.string().max(500).nullable().optional(),
  ogImageUrl: httpUrlSchema.nullable().optional(),
};

export const cmsContentStatusSchema = z.enum(["draft", "published"]);

/** Markdown / plain text body. */
const contentSchema = z.string().max(100_000).nullable().optional();

const blogTagsSchema = z.array(z.string().min(1).max(50)).max(10);

export const createCmsPageSchema = z
  .object({
    title: z.string().min(1).max(300),
    slug: slugSchema.optional(),
    content: contentSchema,
    status: cmsContentStatusSchema.default("draft"),
    ...seoFields,
  })
  .strict();

export const updateCmsPageSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    slug: slugSchema.optional(),
    content: contentSchema,
    status: cmsContentStatusSchema.optional(),
    ...seoFields,
  })
  .strict();

export const createBlogPostSchema = z
  .object({
    title: z.string().min(1).max(300),
    slug: slugSchema.optional(),
    content: contentSchema,
    status: cmsContentStatusSchema.default("draft"),
    excerpt: z.string().max(500).nullable().optional(),
    coverImageUrl: httpUrlSchema.nullable().optional(),
    tags: blogTagsSchema.default([]),
    ...seoFields,
  })
  .strict();

export const updateBlogPostSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    slug: slugSchema.optional(),
    content: contentSchema,
    status: cmsContentStatusSchema.optional(),
    excerpt: z.string().max(500).nullable().optional(),
    coverImageUrl: httpUrlSchema.nullable().optional(),
    tags: blogTagsSchema.optional(),
    ...seoFields,
  })
  .strict();

export const listCmsPagesQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: cmsContentStatusSchema.optional(),
});

export const listBlogPostsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: cmsContentStatusSchema.optional(),
});

export type CreateCmsPageInput = z.infer<typeof createCmsPageSchema>;
export type UpdateCmsPageInput = z.infer<typeof updateCmsPageSchema>;
export type CreateBlogPostInput = z.infer<typeof createBlogPostSchema>;
export type UpdateBlogPostInput = z.infer<typeof updateBlogPostSchema>;
export type ListCmsPagesQuery = z.infer<typeof listCmsPagesQuerySchema>;
export type ListBlogPostsQuery = z.infer<typeof listBlogPostsQuerySchema>;

export type CmsPage = typeof cmsPages.$inferSelect;
export type BlogPost = typeof blogPosts.$inferSelect;

// ── Slug resolution (mirrors catalog: dedupe against live rows) ──

async function resolvePageSlug(db: Db, title: string, requested?: string, excludeId?: string) {
  const base = requested ?? slugify(title);
  const rows = await db
    .select({ slug: cmsPages.slug, id: cmsPages.id })
    .from(cmsPages)
    .where(and(ilike(cmsPages.slug, `${base}%`), isNull(cmsPages.deletedAt)));
  return uniqueSlug(base, new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug)));
}

async function resolvePostSlug(db: Db, title: string, requested?: string, excludeId?: string) {
  const base = requested ?? slugify(title);
  const rows = await db
    .select({ slug: blogPosts.slug, id: blogPosts.id })
    .from(blogPosts)
    .where(and(ilike(blogPosts.slug, `${base}%`), isNull(blogPosts.deletedAt)));
  return uniqueSlug(base, new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug)));
}

// ── Pages: admin CRUD ────────────────────────────────────────

export async function listPagesAdmin(query: ListCmsPagesQuery): Promise<Paginated<CmsPage>> {
  const db = getDb();
  const filters: SQL[] = [isNull(cmsPages.deletedAt)];
  if (query.status) filters.push(eq(cmsPages.status, query.status));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(cmsPages.title, term), ilike(cmsPages.slug, term))!);
  }
  const where = and(...filters);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(cmsPages)
    .where(where);
  const rows = await db
    .select()
    .from(cmsPages)
    .where(where)
    .orderBy(desc(cmsPages.updatedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export async function getCmsPageById(id: string): Promise<CmsPage> {
  const db = getDb();
  const page = await db.query.cmsPages.findFirst({
    where: and(eq(cmsPages.id, id), isNull(cmsPages.deletedAt)),
  });
  if (!page) throw notFound("Page not found");
  return page;
}

export async function createCmsPage(input: CreateCmsPageInput): Promise<CmsPage> {
  const db = getDb();
  const slug = await resolvePageSlug(db, input.title, input.slug);
  const [row] = await db
    .insert(cmsPages)
    .values({
      title: input.title,
      slug,
      content: input.content ?? null,
      status: input.status,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateCmsPage(id: string, input: UpdateCmsPageInput): Promise<CmsPage> {
  const db = getDb();
  const existing = await db.query.cmsPages.findFirst({
    where: and(eq(cmsPages.id, id), isNull(cmsPages.deletedAt)),
  });
  if (!existing) throw notFound("Page not found");

  const slug =
    input.slug !== undefined || input.title !== undefined
      ? await resolvePageSlug(db, input.title ?? existing.title, input.slug ?? existing.slug, id)
      : undefined;

  const [row] = await db
    .update(cmsPages)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
      ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cmsPages.id, id))
    .returning();
  if (!row) throw notFound("Page not found");
  return row;
}

export async function softDeleteCmsPage(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(cmsPages)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(cmsPages.id, id), isNull(cmsPages.deletedAt)))
    .returning({ id: cmsPages.id });
  if (!row) throw notFound("Page not found");
}

// ── Posts: admin CRUD ────────────────────────────────────────

export async function listPostsAdmin(query: ListBlogPostsQuery): Promise<Paginated<BlogPost>> {
  const db = getDb();
  const filters: SQL[] = [isNull(blogPosts.deletedAt)];
  if (query.status) filters.push(eq(blogPosts.status, query.status));
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(or(ilike(blogPosts.title, term), ilike(blogPosts.slug, term))!);
  }
  const where = and(...filters);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(where);
  const rows = await db
    .select()
    .from(blogPosts)
    .where(where)
    .orderBy(desc(blogPosts.updatedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export async function getBlogPostById(id: string): Promise<BlogPost> {
  const db = getDb();
  const post = await db.query.blogPosts.findFirst({
    where: and(eq(blogPosts.id, id), isNull(blogPosts.deletedAt)),
  });
  if (!post) throw notFound("Post not found");
  return post;
}

export async function createBlogPost(input: CreateBlogPostInput): Promise<BlogPost> {
  const db = getDb();
  const slug = await resolvePostSlug(db, input.title, input.slug);
  const [row] = await db
    .insert(blogPosts)
    .values({
      title: input.title,
      slug,
      content: input.content ?? null,
      status: input.status,
      excerpt: input.excerpt ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      tags: input.tags,
      // Auto-set on first publish — including a post created published.
      publishedAt: input.status === "published" ? new Date() : null,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateBlogPost(id: string, input: UpdateBlogPostInput): Promise<BlogPost> {
  const db = getDb();
  const existing = await db.query.blogPosts.findFirst({
    where: and(eq(blogPosts.id, id), isNull(blogPosts.deletedAt)),
  });
  if (!existing) throw notFound("Post not found");

  const slug =
    input.slug !== undefined || input.title !== undefined
      ? await resolvePostSlug(db, input.title ?? existing.title, input.slug ?? existing.slug, id)
      : undefined;

  // publishedAt is set exactly once — on the first transition to published.
  // Re-publishing after a draft round-trip keeps the original date.
  const setPublishedAt =
    input.status === "published" && existing.publishedAt === null
      ? { publishedAt: new Date() }
      : {};

  const [row] = await db
    .update(blogPosts)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
      ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
      ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
      ...setPublishedAt,
      updatedAt: new Date(),
    })
    .where(eq(blogPosts.id, id))
    .returning();
  if (!row) throw notFound("Post not found");
  return row;
}

export async function softDeleteBlogPost(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(blogPosts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(blogPosts.id, id), isNull(blogPosts.deletedAt)))
    .returning({ id: blogPosts.id });
  if (!row) throw notFound("Post not found");
}

// ── Public (storefront) reads — published + non-deleted only ─

export type PublicCmsPage = {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  updatedAt: Date;
};

export async function getPublishedPage(slug: string): Promise<PublicCmsPage> {
  const db = getDb();
  const page = await db.query.cmsPages.findFirst({
    where: and(
      eq(cmsPages.slug, slug),
      eq(cmsPages.status, "published"),
      isNull(cmsPages.deletedAt),
    ),
  });
  if (!page) throw notFound("Page not found");
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    content: page.content,
    metaTitle: page.metaTitle,
    metaDescription: page.metaDescription,
    ogImageUrl: page.ogImageUrl,
    updatedAt: page.updatedAt,
  };
}

/** Blog index card: excerpt only — never the full content. */
export type PublicBlogPostListItem = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  publishedAt: Date | null;
};

export async function listPublishedPosts(query: {
  page: number;
  pageSize: number;
}): Promise<Paginated<PublicBlogPostListItem>> {
  const db = getDb();
  const where = and(eq(blogPosts.status, "published"), isNull(blogPosts.deletedAt));

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(where);
  const rows = await db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      slug: blogPosts.slug,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      tags: blogPosts.tags,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(where)
    .orderBy(desc(blogPosts.publishedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export type PublicBlogPost = PublicBlogPostListItem & {
  content: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  updatedAt: Date;
};

export async function getPublishedPost(slug: string): Promise<PublicBlogPost> {
  const db = getDb();
  const post = await db.query.blogPosts.findFirst({
    where: and(
      eq(blogPosts.slug, slug),
      eq(blogPosts.status, "published"),
      isNull(blogPosts.deletedAt),
    ),
  });
  if (!post) throw notFound("Post not found");
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    content: post.content,
    coverImageUrl: post.coverImageUrl,
    tags: post.tags,
    publishedAt: post.publishedAt,
    metaTitle: post.metaTitle,
    metaDescription: post.metaDescription,
    ogImageUrl: post.ogImageUrl,
    updatedAt: post.updatedAt,
  };
}
