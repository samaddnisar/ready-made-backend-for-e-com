import { ApiError } from "@/lib/client-api";

/** Wire shapes for the discounts admin UI — dates arrive as ISO strings over JSON. */

export type DiscountType = "percent" | "fixed" | "free_shipping";
export type DiscountAppliesTo = "all" | "products" | "categories";

export type DiscountRow = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  minSpend: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  appliesTo: DiscountAppliesTo;
  stackable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  redemptionCount: number;
};

export type DiscountDetail = DiscountRow & {
  productIds: string[];
  categoryIds: string[];
};

export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  percent: "Percent",
  fixed: "Fixed",
  free_shipping: "Free shipping",
};

export const APPLIES_TO_LABELS: Record<DiscountAppliesTo, string> = {
  all: "All products",
  products: "Products",
  categories: "Categories",
};

/**
 * Toast description for API failures: flattens validation `details`
 * ({ path, message }[]) into a readable line, else the server message.
 */
export function describeApiError(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : undefined;
  }
  if (Array.isArray(err.details) && err.details.length > 0) {
    const lines = (err.details as { path?: unknown; message?: unknown }[])
      .map((d) => {
        if (typeof d.message !== "string") return null;
        return typeof d.path === "string" && d.path.length > 0
          ? `${d.path}: ${d.message}`
          : d.message;
      })
      .filter((l): l is string => l !== null);
    if (lines.length > 0) return lines.join(" · ");
  }
  return err.message;
}
