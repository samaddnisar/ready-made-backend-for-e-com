import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { can, requireReadPage } from "@/lib/auth";
import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const admin = await requireReadPage("users");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & roles"
        description="Invite admins, assign roles and control what each role can do (RBAC)."
      />
      <UsersClient
        currentAdminId={admin.adminUser.id}
        canCreate={can(admin, "users", "create")}
        canManage={can(admin, "users", "update")}
        canDelete={can(admin, "users", "delete")}
      />
    </div>
  );
}
