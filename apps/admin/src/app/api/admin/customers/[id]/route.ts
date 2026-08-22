import {
  getCustomerDetail,
  notFound,
  softDeleteCustomer,
  updateCustomerAdmin,
  updateCustomerAdminSchema,
  uuidSchema,
} from "@repo/core";
import { ok, parseBody, withAdminApi } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminApi(
  { resource: "customers", action: "read" },
  async (_req, { params }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    return ok(await getCustomerDetail(id));
  },
);

export const PATCH = withAdminApi(
  { resource: "customers", action: "update" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();
    const input = await parseBody(req, updateCustomerAdminSchema);

    const customer = await updateCustomerAdmin(id, input);

    await writeAudit({
      admin,
      req,
      action: "update",
      resource: "customer",
      resourceId: id,
      diff: { after: input },
    });

    return ok(customer);
  },
);

export const DELETE = withAdminApi(
  { resource: "customers", action: "delete" },
  async (req, { params, admin }) => {
    const { id } = await params;
    if (!id || !uuidSchema.safeParse(id).success) throw notFound();

    await softDeleteCustomer(id);

    await writeAudit({
      admin,
      req,
      action: "delete",
      resource: "customer",
      resourceId: id,
    });

    return ok({ deleted: true });
  },
);
