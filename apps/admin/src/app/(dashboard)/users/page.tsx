import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/page-placeholder";
import { requireReadPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Users & roles" };

export default async function Page() {
  await requireReadPage("users");
  return <PagePlaceholder title={"Users & roles"} description={"Admin accounts, role management and invitations (RBAC)."} phase={9} />;
}
