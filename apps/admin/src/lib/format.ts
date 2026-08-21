/** Format integer minor units (cents) as localized currency. */
export function formatMoney(cents: number | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Money range for product lists: "$10.00" or "$10.00 – $25.00". */
export function formatMoneyRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string,
): string {
  if (min === null || min === undefined) return "—";
  if (max === null || max === undefined || max === min) return formatMoney(min, currency);
  return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}
