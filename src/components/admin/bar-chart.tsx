"use client";

import { useId, useMemo, useState } from "react";

type Point = { day: string; value: number };

// Single-series column chart (one brand hue, so no legend: the title names it).
// Marks follow the house spec: ≤24px columns, 4px rounded data-end, square at the
// baseline, 2px surface gap, hairline grid, sparse labels. Hover or arrow keys
// show a tooltip; the table view carries every value without the tooltip.

const W = 480;
const H = 200;
const PAD = { top: 12, right: 6, bottom: 24, left: 44 };

function niceMax(max: number) {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * exp >= max / 1) ?? 10;
  return step * exp;
}

function bucket(points: Point[]): Point[] {
  const size = points.length > 180 ? 30 : points.length > 60 ? 7 : 1;
  if (size === 1) return points;
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += size) {
    const slice = points.slice(i, i + size);
    out.push({ day: slice[0].day, value: slice.reduce((s, p) => s + p.value, 0) });
  }
  return out;
}

export function BarChart({
  title,
  points,
  format,
  locale,
  summary,
  tableLabel,
}: {
  title: string;
  points: Point[];
  format: "iqd" | "count";
  locale: string;
  summary: string;
  tableLabel: { show: string; date: string; value: string };
}) {
  const id = useId();
  const data = useMemo(() => bucket(points), [points]);
  const [active, setActive] = useState<number | null>(null);
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", { maximumFractionDigits: 0, notation: "standard" });
  const compact = new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", { notation: "compact", maximumFractionDigits: 1 });
  const fmt = (v: number) => (format === "iqd" ? `${nf.format(v)} ${locale === "ar" ? "د.ع" : "IQD"}` : nf.format(v));
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const label = (day: string) => dateFmt.format(new Date(`${day}T00:00:00Z`));

  const rawMax = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const max = format === "count" ? Math.max(1, Math.ceil(rawMax)) : rawMax;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  // Counts get whole-number ticks only.
  const ticks = format === "count" && max < 4 ? [0, max] : [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / 5));

  const bar = (v: number, x: number) => {
    const top = y(v);
    const h = PAD.top + innerH - top;
    if (h <= 0) return "";
    const r = Math.min(4, h, barW / 2);
    // Rounded data-end (top), square at the baseline.
    return `M${x},${PAD.top + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD.top + innerH} Z`;
  };

  const activePoint = active !== null ? data[active] : null;
  const activeX = active !== null ? PAD.left + active * slot + slot / 2 : 0;

  return (
    <figure className="space-y-2">
      <figcaption className="font-display text-base font-semibold">{title}</figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-pan-y"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const dir = (e.key === "ArrowRight") !== (locale === "ar") ? 1 : -1;
              setActive((a) => Math.max(0, Math.min(data.length - 1, (a ?? (dir > 0 ? -1 : data.length)) + dir)));
            } else if (e.key === "Escape") setActive(null);
          }}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          style={{ direction: "ltr" }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--rn-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="var(--rn-text-muted)">
                {compact.format(tick)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            return (
              <g key={d.day} onPointerEnter={() => setActive(i)}>
                {/* Hit target: the full slot, taller than the mark. */}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                <path d={bar(d.value, x)} fill="var(--rn-primary)" opacity={active === null || active === i ? 1 : 0.45} />
                {i % labelEvery === 0 || i === data.length - 1 ? (
                  <text x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--rn-text-muted)">
                    {label(d.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {activePoint ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs shadow-sm"
            style={{ left: `${(activeX / W) * 100}%` }}
          >
            <strong className="ltr-nums block text-sm">{fmt(activePoint.value)}</strong>
            <span className="text-muted">{label(activePoint.day)}</span>
          </div>
        ) : null}
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-primary-text">{tableLabel.show}</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm" aria-labelledby={`${id}-cap`}>
            <caption id={`${id}-cap`} className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-start">{tableLabel.date}</th>
                <th scope="col" className="px-3 py-1.5 text-end">{tableLabel.value}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="px-3 py-1">{label(d.day)}</td>
                  <td className="ltr-nums px-3 py-1 text-end">{fmt(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
