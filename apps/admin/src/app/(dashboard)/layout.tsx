import { getSettings, hasPermission, normalizeFlags } from "@repo/core";

// Everything under the admin shell reads auth + DB state per request.
export const dynamic = "force-dynamic";
import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { requireAdminPage } from "@/lib/auth";
import { NAV_SECTIONS } from "@/lib/nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  const settings = await getSettings();
  const flags = normalizeFlags(settings.featureFlags);

  const visibleHrefs = NAV_SECTIONS.flatMap((s) => s.items)
    .filter((item) => hasPermission(admin.permissions, item.resource, "read"))
    .filter((item) => !item.feature || flags[item.feature])
    .map((item) => item.href);

  return (
    <div className="flex min-h-screen">
      <Sidebar visibleHrefs={visibleHrefs} storeName={settings.storeName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          email={admin.adminUser.email}
          name={admin.adminUser.name}
          roleName={admin.roleName}
        />
        <main className="flex-1 p-6">{children}</main>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
