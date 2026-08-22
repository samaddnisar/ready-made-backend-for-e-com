import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db";
import type { Db } from "../db/client";
import { blogPosts, cmsPages } from "../db/schema";
import {
  createBlogPost,
  createCmsPage,
  getPublishedPage,
  getPublishedPost,
  listPagesAdmin,
  listPostsAdmin,
  listPublishedPosts,
  softDeleteBlogPost,
  softDeleteCmsPage,
  updateBlogPost,
  updateCmsPage,
} from "./cms";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(blogPosts);
  await db.delete(cmsPages);
});

describe("publish flow", () => {
  it("drafts have no publishedAt; first publish sets it exactly once", async () => {
    const post = await createBlogPost({ title: "Hello", status: "draft", tags: [] });
    expect(post.publishedAt).toBeNull();

    const published = await updateBlogPost(post.id, { status: "published" });
    expect(published.publishedAt).not.toBeNull();
    const firstPublishedAt = published.publishedAt!.getTime();

    // Editing a published post never bumps publishedAt.
    const edited = await updateBlogPost(post.id, { title: "Hello again" });
    expect(edited.publishedAt!.getTime()).toBe(firstPublishedAt);

    // Draft round-trip + re-publish keeps the original date.
    await updateBlogPost(post.id, { status: "draft" });
    const republished = await updateBlogPost(post.id, { status: "published" });
    expect(republished.publishedAt!.getTime()).toBe(firstPublishedAt);
  });

  it("a post created directly as published gets publishedAt immediately", async () => {
    const post = await createBlogPost({ title: "Launch", status: "published", tags: [] });
    expect(post.publishedAt).not.toBeNull();
  });
});

describe("public visibility", () => {
  it("drafts are invisible publicly; published pages/posts resolve", async () => {
    const draftPage = await createCmsPage({ title: "Hidden page", status: "draft" });
    const draftPost = await createBlogPost({ title: "Hidden post", status: "draft", tags: [] });
    await expect(getPublishedPage(draftPage.slug)).rejects.toThrow(/not found/i);
    await expect(getPublishedPost(draftPost.slug)).rejects.toThrow(/not found/i);

    const page = await createCmsPage({ title: "About us", status: "published", content: "# Hi" });
    const post = await createBlogPost({
      title: "First post",
      status: "published",
      content: "Body text",
      excerpt: "Teaser",
      tags: ["news"],
    });

    const publicPage = await getPublishedPage(page.slug);
    expect(publicPage.content).toBe("# Hi");

    const publicPost = await getPublishedPost(post.slug);
    expect(publicPost.content).toBe("Body text");
    expect(publicPost.tags).toEqual(["news"]);

    const list = await listPublishedPosts({ page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
    expect(list.items[0]!.slug).toBe(post.slug);
    expect(list.items[0]!.excerpt).toBe("Teaser");
    // Index cards carry the excerpt only — never the full content.
    expect("content" in list.items[0]!).toBe(false);
  });

  it("soft-deleted published content stops resolving publicly", async () => {
    const page = await createCmsPage({ title: "Terms", status: "published" });
    const post = await createBlogPost({ title: "Old news", status: "published", tags: [] });
    await softDeleteCmsPage(page.id);
    await softDeleteBlogPost(post.id);

    await expect(getPublishedPage(page.slug)).rejects.toThrow(/not found/i);
    await expect(getPublishedPost(post.slug)).rejects.toThrow(/not found/i);
    expect((await listPublishedPosts({ page: 1, pageSize: 10 })).total).toBe(0);
  });
});

describe("slug handling", () => {
  it("generates from the title and dedupes with -2, -3", async () => {
    const first = await createCmsPage({ title: "About Us", status: "draft" });
    const second = await createCmsPage({ title: "About Us", status: "draft" });
    const third = await createCmsPage({ title: "About Us", status: "draft" });
    expect(first.slug).toBe("about-us");
    expect(second.slug).toBe("about-us-2");
    expect(third.slug).toBe("about-us-3");

    const post1 = await createBlogPost({ title: "Hello World", status: "draft", tags: [] });
    const post2 = await createBlogPost({ title: "Hello World", status: "draft", tags: [] });
    expect(post1.slug).toBe("hello-world");
    expect(post2.slug).toBe("hello-world-2");
  });

  it("dedupes an explicitly requested slug on update", async () => {
    await createCmsPage({ title: "Contact", status: "draft" });
    const page = await createCmsPage({ title: "Reach us", status: "draft" });
    const updated = await updateCmsPage(page.id, { slug: "contact" });
    expect(updated.slug).toBe("contact-2");
  });

  it("soft delete frees the slug for reuse", async () => {
    const page = await createCmsPage({ title: "About", status: "published" });
    expect(page.slug).toBe("about");
    await softDeleteCmsPage(page.id);

    const replacement = await createCmsPage({ title: "About", status: "published" });
    expect(replacement.slug).toBe("about");

    // Partial unique index allows the live row alongside the deleted one.
    const rows = await db.select().from(cmsPages).where(eq(cmsPages.slug, "about"));
    expect(rows).toHaveLength(2);
    expect((await getPublishedPage("about")).id).toBe(replacement.id);
  });
});

describe("admin lists", () => {
  it("filters by status and q, excludes soft-deleted rows", async () => {
    await createCmsPage({ title: "Shipping policy", status: "published" });
    await createCmsPage({ title: "Returns policy", status: "draft" });
    const gone = await createCmsPage({ title: "Old policy", status: "draft" });
    await softDeleteCmsPage(gone.id);

    const all = await listPagesAdmin({ page: 1, pageSize: 10 });
    expect(all.total).toBe(2);

    const drafts = await listPagesAdmin({ page: 1, pageSize: 10, status: "draft" });
    expect(drafts.total).toBe(1);
    expect(drafts.items[0]!.title).toBe("Returns policy");

    const search = await listPagesAdmin({ page: 1, pageSize: 10, q: "shipping" });
    expect(search.total).toBe(1);
    expect(search.items[0]!.title).toBe("Shipping policy");

    await createBlogPost({ title: "Summer sale", status: "published", tags: [] });
    await createBlogPost({ title: "Winter sale", status: "draft", tags: [] });
    const posts = await listPostsAdmin({ page: 1, pageSize: 10, status: "published" });
    expect(posts.total).toBe(1);
    expect(posts.items[0]!.title).toBe("Summer sale");
  });
});
