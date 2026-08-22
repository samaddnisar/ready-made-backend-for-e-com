"use client";

import { formatMoney } from "@/lib/format";

export type RevenueDay = { date: string; revenue: number; orders: number };

const WIDTH = 720;
const HEIGHT = 240;
const PAD_X = 8;
const PAD_TOP = 20;
const PAD_BOTTOM = 26;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;
const BASE_Y = HEIGHT - PAD_BOTTOM;

/** "YYYY-MM-DD" → "Aug 5" (parsed field-by-field to avoid timezone day shifts). */
function formatDayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

/**
 * Dependency-free inline SVG bar chart of revenue per day. Bars scale to the
 * max revenue in the window; day labels stay sparse (first, last, every ~5th);
 * hovering a column shows a native tooltip via <title>.
 */
export function RevenueChart({ data, currency }: { data: RevenueDay[]; currency: string }) {
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 0);

  if (data.length === 0 || maxRevenue === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No revenue in this period.
      </div>
    );
  }

  const n = data.length;
  const plotWidth = WIDTH - PAD_X * 2;
  const slot = plotWidth / n;
  const gap = Math.min(slot * 0.25, 8);
  const barWidth = Math.max(slot - gap, 1);
  // Aim for ~6-8 labels: every ~5th day on the default 30-day window.
  const labelStep = Math.max(1, Math.ceil(n / 7));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Revenue by day"
    >
      {/* Max-revenue gridline for scale. */}
      <line
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={PAD_TOP}
        y2={PAD_TOP}
        className="stroke-border"
        strokeWidth={1}
        strokeDasharray="3 4"
      />
      <text x={PAD_X} y={PAD_TOP - 6} fontSize={10} className="fill-muted-foreground">
        {formatMoney(maxRevenue, currency)}
      </text>

      {data.map((day, i) => {
        const x = PAD_X + i * slot;
        const barHeight =
          day.revenue > 0 ? Math.max((day.revenue / maxRevenue) * PLOT_HEIGHT, 2) : 0;
        const isFirst = i === 0;
        const isLast = i === n - 1;
        // Sparse labels: first, last, and every ~5th — skipping any that would
        // crowd the final label.
        const showLabel = isFirst || isLast || (i % labelStep === 0 && n - 1 - i >= labelStep);
        const label = formatDayLabel(day.date);

        return (
          <g key={day.date}>
            <title>
              {`${label} — ${formatMoney(day.revenue, currency)} · ${day.orders} ${
                day.orders === 1 ? "order" : "orders"
              }`}
            </title>
            {/* Invisible full-height hover target so tiny bars still get a tooltip. */}
            <rect x={x} y={PAD_TOP} width={slot} height={PLOT_HEIGHT} fill="transparent" />
            {barHeight > 0 ? (
              <rect
                x={x + gap / 2}
                y={BASE_Y - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 2)}
                className="fill-primary/80 hover:fill-primary"
              />
            ) : null}
            {showLabel ? (
              <text
                x={isFirst ? x : isLast ? x + slot : x + slot / 2}
                y={HEIGHT - 8}
                fontSize={10}
                textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                className="fill-muted-foreground"
              >
                {label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* Baseline. */}
      <line
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={BASE_Y}
        y2={BASE_Y}
        className="stroke-border"
        strokeWidth={1}
      />
    </svg>
  );
}
