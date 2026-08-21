import type { Metadata } from "next";
import { can, requireReadPage } from "@/lib/auth";
import { MediaClient } from "./media-client";

export const metadata: Metadata = { title: "Media library" };

export default async function MediaPage() {
  const admin = await requireReadPage("media");
  return <MediaClient canWrite={can(admin, "media", "create")} />;
}
