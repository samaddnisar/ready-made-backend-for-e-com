import { z } from "zod";

/** Shared primitives — reject unknown fields at the object level (§9). */

export const uuidSchema = z.uuid();

export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be lowercase letters, numbers and hyphens");

/** ISO 4217 uppercase currency code. */
export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO currency code");

/** Money in integer minor units (cents). */
export const moneySchema = z.number().int().min(0);

export const emailSchema = z.email().max(320);

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(items: T[], page: number, pageSize: number, total: number): Paginated<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
