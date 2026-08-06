'use client';

import { useMemo } from 'react';

/**
 * RevenueChart — a hand-rolled SVG line+area chart of daily revenue over the
 * analytics window, with a by-plan breakdown below it as horizontal bars.
 *
 * No chart library: the data is a gap-filled daily series from
 * /api/analytics/overview, so every day has a point and the x-axis is even.
 * The SVG uses a fixed viewBox and scales to its container, so it stays crisp
 * at any width. brand-500 (#14b8a6) is the series colour.
 *
 * Props: { data, loading }
 *   data = { days, daily:[{day,revenue,count}], byPlan:[{plan,count,revenue}], totals:{...} }
 */
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

// Fixed drawing surface; the SVG scales responsively to its container width.
const W = 720, H = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 52 };
const IW = W - PAD.left - PAD.right;   // inner width
const IH = H - PAD.top - PAD.bottom;   // inner height

export default function RevenueChart({ data, loading = false }) {
  const daily  = data?.daily || [];
  const byPlan = data?.byPlan || [];
  const totals = data?.totals || {};

  const chart = useMemo(() => buildChart(daily), [daily]);

  if (loading) {
    return <div className="h-56 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />;
  }

  const hasRevenue = daily.some((d) => d.revenue > 0);

  return (
    <div className="space-y-5">
      {/* Header: window vs all-time totals */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Revenue · last {data?.days || 30} days
          </p>
          <p className="mt-0.5 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {naira(totals.windowRevenue)}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <p>{totals.windowCount || 0} sales in window</p>
          <p className="text-slate-400 dark:text-slate-500">{naira(totals.allTimeRevenue)} all-time</p>
        </div>
      </div>

      {/* Line + area chart */}
      {hasRevenue ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Daily revenue over the last ${data?.days || 30} days. Total ${naira(totals.windowRevenue)} from ${totals.windowCount || 0} sales.`}
          preserveAspectRatio="none"
        >
          {/* horizontal gridlines + y labels */}
          {chart.ticks.map((t) => (
            <g key={t.y}>
              <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
                    className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
              <text x={PAD.left - 8} y={t.y + 3} textAnchor="end"
                    className="fill-slate-400 dark:fill-slate-500" fontSize="10">
                {t.label}
              </text>
            </g>
          ))}

          {/* area under the line */}
          <path d={chart.areaPath} fill="url(#revFill)" />
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#14b8a6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* the line */}
          <path d={chart.linePath} fill="none" stroke="#14b8a6" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />

          {/* x labels (sparse: first, middle, last) */}
          {chart.xLabels.map((l) => (
            <text key={l.x} x={l.x} y={H - 8} textAnchor={l.anchor}
                  className="fill-slate-400 dark:fill-slate-500" fontSize="10">
              {l.label}
            </text>
          ))}
        </svg>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          No sales in this window yet.
        </div>
      )}

      {/* By-plan breakdown */}
      {byPlan.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            By plan
          </p>
          <ul className="space-y-2">
            {byPlan.map((p) => {
              const max = byPlan[0]?.revenue || 1; // sorted desc by revenue server-side
              const pct = Math.max(2, Math.round((p.revenue / max) * 100));
              return (
                <li key={p.plan} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate text-slate-700 dark:text-slate-300" title={p.plan}>
                    {p.plan}
                  </span>
                  <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-brand-500"
                          style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right font-medium text-slate-800 dark:text-slate-200">
                    {naira(p.revenue)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">
                    {p.count}×
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Compute SVG paths, y-axis ticks, and sparse x labels from the daily series.
function buildChart(daily) {
  const n = daily.length;
  const maxRev = Math.max(1, ...daily.map((d) => d.revenue));
  const niceMax = niceCeil(maxRev);

  const x = (i) => PAD.left + (n <= 1 ? IW / 2 : (i / (n - 1)) * IW);
  const y = (v) => PAD.top + IH - (v / niceMax) * IH;

  // line + area paths
  let linePath = '';
  daily.forEach((d, i) => {
    linePath += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.revenue).toFixed(1)} `;
  });
  const areaPath = n
    ? `${linePath}L${x(n - 1).toFixed(1)},${(PAD.top + IH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + IH).toFixed(1)} Z`
    : '';

  // 4 horizontal gridlines (0, 1/3, 2/3, max)
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => {
    const val = niceMax * f;
    return { y: y(val), label: shortNaira(val) };
  });

  // sparse x labels: first, middle, last
  const idxs = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const xLabels = idxs
    .filter((i) => daily[i])
    .map((i) => ({
      x: x(i),
      label: fmtDay(daily[i].day),
      anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
    }));

  return { linePath: linePath.trim(), areaPath, ticks, xLabels };
}

// Round a max value up to a "nice" number so gridlines read cleanly.
function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function shortNaira(v) {
  if (v >= 1_000_000) return '₦' + (v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0) + 'M';
  if (v >= 1_000)     return '₦' + (v / 1_000).toFixed(v % 1_000 ? 1 : 0) + 'k';
  return '₦' + Math.round(v);
}

function fmtDay(iso) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  } catch { return iso; }
}
