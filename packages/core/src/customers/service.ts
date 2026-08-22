import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { addresses, customers, orders } from "../db/schema";
import { conflict, notFound } from "../errors";
import { paginate, type Paginated } from "../validation/common";
import type {
  AddressInput,
  ListCustomersQuery,
  UpdateAddressInput,
  UpdateCustomerAdminInput,
  UpdateProfileInput,
} from "../validation/customers";

export type Customer = typeof customers.$inferSelect;
export type Address = typeof addresses.$inferSelect;

const notDeleted = isNull(customers.deletedAt);

/**
 * Lifetime value = sum of grand totals of orders the customer actually paid
 * for and kept (paid → completed, incl. partially_refunded; excludes
 * pending/failed/cancelled and fully refunded orders).
 */
const LTV_STATUSES = sql`('paid','fulfilled','shipped','delivered','completed','partially_refunded')`;

const lifetimeValueSql = sql<number>`coalesce((select sum(o.grand_total)::int from orders o where o.customer_id = customers.id and o.status::text in ${LTV_STATUSES}), 0)`;
const orderCountSql = sql<number>`(select count(*)::int from orders o where o.customer_id = customers.id and o.status::text in ${LTV_STATUSES})`;

// ── Admin ────────────────────────────────────────────────────

export type CustomerListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  marketingOptIn: boolean;
  orderCount: number;
  lifetimeValue: number;
  createdAt: Date;
};

export async function listCustomers(query: ListCustomersQuery): Promise<Paginated<CustomerListItem>> {
  const db = getDb();
  const filters: SQL[] = [notDeleted];
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(customers.email, term),
        ilike(customers.firstName, term),
        ilike(customers.lastName, term),
      )!,
    );
  }
  const where = and(...filters);
  const direction = query.order === "asc" ? asc : desc;
  const orderBy =
    query.sort === "lifetimeValue"
      ? query.order === "asc"
        ? sql`${lifetimeValueSql} asc`
        : sql`${lifetimeValueSql} desc`
      : query.sort === "orderCount"
        ? query.order === "asc"
          ? sql`${orderCountSql} asc`
          : sql`${orderCountSql} desc`
        : direction(customers.createdAt);

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where);
  const rows = await db
    .select({
      id: customers.id,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      marketingOptIn: customers.marketingOptIn,
      orderCount: orderCountSql,
      lifetimeValue: lifetimeValueSql,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(where)
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

export type CustomerDetail = Customer & {
  addresses: Address[];
  orderCount: number;
  lifetimeValue: number;
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    grandTotal: number;
    currency: string;
    createdAt: Date;
  }[];
};

export async function getCustomerDetail(id: string): Promise<CustomerDetail> {
  const db = getDb();
  const customer = await db.query.customers.findFirst({
    where: and(eq(customers.id, id), notDeleted),
    with: { addresses: { where: isNull(addresses.deletedAt), orderBy: desc(addresses.isDefault) } },
  });
  if (!customer) throw notFound("Customer not found");

  const [stats] = await db
    .select({ orderCount: orderCountSql, lifetimeValue: lifetimeValueSql })
    .from(customers)
    .where(eq(customers.id, id));

  const recentOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: sql<string>`${orders.status}::text`,
      grandTotal: orders.grandTotal,
      currency: orders.currency,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.customerId, id))
    .orderBy(desc(orders.createdAt))
    .limit(20);

  return {
    ...customer,
    orderCount: stats?.orderCount ?? 0,
    lifetimeValue: stats?.lifetimeValue ?? 0,
    recentOrders,
  };
}

export async function updateCustomerAdmin(
  id: string,
  input: UpdateCustomerAdminInput,
): Promise<Customer> {
  const db = getDb();
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(customers)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(customers.id, id), notDeleted))
    .returning();
  if (!row) throw notFound("Customer not found");
  return row;
}

export async function softDeleteCustomer(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(customers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(customers.id, id), notDeleted))
    .returning({ id: customers.id });
  if (!row) throw notFound("Customer not found");
}

// ── Storefront (authed via Supabase access token) ────────────

/**
 * Resolve (or create) the customers row for an authenticated Supabase user.
 * First login also claims past guest orders placed with the same email so
 * order history is complete.
 */
export async function getOrCreateCustomerByAuth(
  authUserId: string,
  email: string,
): Promise<Customer> {
  const db = getDb();
  const existing = await db.query.customers.findFirst({
    where: and(eq(customers.authUserId, authUserId), notDeleted),
  });
  if (existing) return existing;

  // A guest-checkout customer row with this email may already exist — link it.
  const byEmail = await db.query.customers.findFirst({
    where: and(eq(customers.email, email.toLowerCase()), notDeleted),
  });
  let customer: Customer;
  if (byEmail && byEmail.authUserId === null) {
    const [linked] = await db
      .update(customers)
      .set({ authUserId, updatedAt: new Date() })
      .where(eq(customers.id, byEmail.id))
      .returning();
    customer = linked!;
  } else if (byEmail) {
    // Email already linked to a different auth user — never merge silently.
    throw conflict("This email is already associated with another account");
  } else {
    const [created] = await db
      .insert(customers)
      .values({ authUserId, email: email.toLowerCase() })
      .onConflictDoNothing()
      .returning();
    customer =
      created ??
      (await db.query.customers.findFirst({
        where: and(eq(customers.authUserId, authUserId), notDeleted),
      }))!;
  }

  // Claim guest orders placed with this email before the account existed.
  await db
    .update(orders)
    .set({ customerId: customer.id })
    .where(and(sql`lower(${orders.email}) = ${email.toLowerCase()}`, isNull(orders.customerId)));

  return customer;
}

export async function updateProfile(customerId: string, input: UpdateProfileInput): Promise<Customer> {
  const db = getDb();
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(customers)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(customers.id, customerId), notDeleted))
    .returning();
  if (!row) throw notFound("Customer not found");
  return row;
}

export async function listCustomerOrders(
  customerId: string,
  query: { page: number; pageSize: number },
): Promise<
  Paginated<{
    id: string;
    orderNumber: string;
    status: string;
    grandTotal: number;
    currency: string;
    createdAt: Date;
  }>
> {
  const db = getDb();
  const where = eq(orders.customerId, customerId);
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: sql<string>`${orders.status}::text`,
      grandTotal: orders.grandTotal,
      currency: orders.currency,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return paginate(rows, query.page, query.pageSize, countRow?.total ?? 0);
}

/** Order detail scoped to the owning customer (never leaks others' orders). */
export async function getCustomerOrder(customerId: string, orderId: string) {
  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.customerId, customerId)),
    with: { items: true },
  });
  if (!order) throw notFound("Order not found");
  // Internal admin notes never leave the admin (§5).
  const { notes: _notes, ...safe } = order;
  return safe;
}

// ── Addresses ────────────────────────────────────────────────

export async function listAddresses(customerId: string): Promise<Address[]> {
  const db = getDb();
  return db
    .select()
    .from(addresses)
    .where(and(eq(addresses.customerId, customerId), isNull(addresses.deletedAt)))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}

export async function createAddress(customerId: string, input: AddressInput): Promise<Address> {
  const db = getDb();
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(addresses)
        .set({ isDefault: false })
        .where(and(eq(addresses.customerId, customerId), eq(addresses.type, input.type)));
    }
    const [row] = await tx
      .insert(addresses)
      .values({ ...input, customerId })
      .returning();
    if (!row) throw new Error("Address insert failed");
    return row;
  });
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<Address> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx.query.addresses.findFirst({
      where: and(
        eq(addresses.id, addressId),
        eq(addresses.customerId, customerId),
        isNull(addresses.deletedAt),
      ),
    });
    if (!existing) throw notFound("Address not found");

    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (input.isDefault) {
      await tx
        .update(addresses)
        .set({ isDefault: false })
        .where(
          and(eq(addresses.customerId, customerId), eq(addresses.type, input.type ?? existing.type)),
        );
    }
    const [row] = await tx
      .update(addresses)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(addresses.id, addressId))
      .returning();
    if (!row) throw notFound("Address not found");
    return row;
  });
}

export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(addresses)
    .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(addresses.id, addressId),
        eq(addresses.customerId, customerId),
        isNull(addresses.deletedAt),
      ),
    )
    .returning({ id: addresses.id });
  if (!row) throw notFound("Address not found");
}
