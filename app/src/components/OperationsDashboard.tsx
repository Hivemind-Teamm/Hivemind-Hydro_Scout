'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_META, type Hydrant, type HydrantStatus } from '../data/hydrants';
import { type Report } from '../data/reports';
import {
  complianceStats, conditionTrend, statusBreakdown, zoneStats,
  type StatusBreakdown, type TrendPoint, type ZoneStats,
} from '../data/operations-stats';
import { useAuth, type Role } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import PillBadge from './PillBadge';

interface Props {
  hydrants: Hydrant[];
  reports: Report[];
  role: Role;
  onClose: () => void;
  onFindOnMap: (hydrantId: string) => void;
}

/* ── Donut chart ──────────────────────────────────────────────────────────── */
// The ring and percentage cover field-checked hydrants only. Temporarily
// unavailable (BFP reference) hydrants are listed under it but not counted.
function DonutChart({ breakdown }: { breakdown: StatusBreakdown }) {
  const { isDark } = useTheme();
  const { operational, reduced, out, checked, pending, operationalPct } = breakdown;
  const r = 40;
  const cx = 56;
  const cy = 56;
  const circumference = 2 * Math.PI * r;

  const segs = [
    { color: STATUS_META.operational.color, count: operational },
    { color: STATUS_META.reduced.color, count: reduced },
    { color: STATUS_META.out.color, count: out },
  ];

  let cumulativeAngle = -90;
  const arcs = segs.map(seg => {
    const pct = checked > 0 ? seg.count / checked : 0;
    const dashLen = pct * circumference;
    const startAngle = cumulativeAngle;
    cumulativeAngle += pct * 360;
    return { color: seg.color, dashLen, startAngle };
  });

  return (
    <div className="flex items-center gap-5">
      <svg width="112" height="112" viewBox="0 0 112 112" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={isDark ? '#374151' : '#f3f4f6'} strokeWidth="15" />
        {arcs.map((arc, i) =>
          arc.dashLen > 0 ? (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={arc.color}
              strokeWidth="15"
              strokeDasharray={`${arc.dashLen} ${circumference - arc.dashLen}`}
              transform={`rotate(${arc.startAngle} ${cx} ${cy})`}
            />
          ) : null
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="800" fill={isDark ? '#f3f4f6' : '#111827'}>
          {operationalPct === null ? '—' : `${operationalPct}%`}
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#9ca3af" letterSpacing="0.8">
          OPERATIONAL
        </text>
      </svg>

      <div className="flex flex-col gap-2.5 text-xs">
        {[
          { color: STATUS_META.operational.color, label: 'Operational',    value: operational },
          { color: STATUS_META.reduced.color,     label: 'Reduced PSI',    value: reduced     },
          { color: STATUS_META.out.color,         label: 'Out of service', value: out         },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} />
            <span className="text-neutral-500 dark:text-neutral-400">{item.label}</span>
            <span className="ml-2 font-bold tabular-nums text-neutral-800 dark:text-neutral-100">{item.value}</span>
          </div>
        ))}
        <div className="mt-0.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: STATUS_META.reference.color }} />
            <span className="text-neutral-500 dark:text-neutral-400">{STATUS_META.reference.legendLabel}</span>
            <span className="ml-2 font-bold tabular-nums text-neutral-800 dark:text-neutral-100">{pending}</span>
          </div>
          <p className="mt-1 pl-4 text-[10px] text-neutral-400 dark:text-neutral-500">Pending field check · not in the %</p>
        </div>
      </div>
    </div>
  );
}

/* ── Trend chart ──────────────────────────────────────────────────────────── */
// Drawn at the card's real pixel width (a scaled viewBox blew text and dots
// up on wide screens) on a fixed 0–100% scale. Weeks with no checked
// hydrants are left as gaps.
const TREND_PAD = { top: 24, right: 20, bottom: 30, left: 42 };

function formatTrendDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function TrendChart({ points, height = 170 }: { points: TrendPoint[]; height?: number }) {
  const { isDark } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cW = width - TREND_PAD.left - TREND_PAD.right;
  const cH = height - TREND_PAD.top - TREND_PAD.bottom;
  const baseY = TREND_PAD.top + cH;
  const toX = (i: number) => TREND_PAD.left + (points.length > 1 ? (i / (points.length - 1)) * cW : cW / 2);
  const toY = (pct: number) => baseY - (pct / 100) * cH;

  // Unbroken runs of weeks that have a value.
  const runs: { x: number; y: number }[][] = [];
  points.forEach((p, i) => {
    if (p.operationalPct === null) { runs.push([]); return; }
    if (!runs.length) runs.push([]);
    runs[runs.length - 1].push({ x: toX(i), y: toY(p.operationalPct) });
  });
  const lines = runs.filter((run) => run.length > 0);
  // Every other date label on narrow cards so they don't collide, counted back from Today.
  const labelEvery = cW / Math.max(1, points.length - 1) < 52 ? 2 : 1;
  const muted = isDark ? '#6b7280' : '#9ca3af';

  return (
    <div ref={wrapRef} className="w-full">
      {lines.length === 0 ? (
        <p className="py-10 text-center text-xs text-neutral-400 dark:text-neutral-500">No field-checked hydrants yet.</p>
      ) : (
        <svg width={width} height={height} role="img" aria-label="Operational percentage of checked hydrants by week">
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={TREND_PAD.left} y1={toY(v)} x2={width - TREND_PAD.right} y2={toY(v)}
                stroke={isDark ? '#2f3540' : '#e5e7eb'} strokeWidth="1" strokeDasharray={v === 0 ? undefined : '4 4'} />
              <text x={TREND_PAD.left - 8} y={toY(v) + 3.5} textAnchor="end" fontSize="10" fill={muted}>{v}%</text>
            </g>
          ))}
          {lines.map((run, i) => {
            const d = run.map((pt, j) => `${j ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' ');
            return (
              <g key={i}>
                <path d={`${d} L ${run.at(-1)!.x} ${baseY} L ${run[0].x} ${baseY} Z`} fill="#e0353b" opacity={isDark ? 0.14 : 0.07} />
                <path d={d} fill="none" stroke="#e0353b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {points.map((p, i) => p.operationalPct === null ? null : (
            <g key={p.day}>
              <circle cx={toX(i)} cy={toY(p.operationalPct)} r="3.5" fill="#e0353b" stroke={isDark ? '#171717' : '#ffffff'} strokeWidth="1.5" />
              <text x={toX(i)} y={toY(p.operationalPct) - 9} textAnchor="middle" fontSize="10" fontWeight="700"
                fill={isDark ? '#e5e7eb' : '#374151'}>{p.operationalPct}%</text>
            </g>
          ))}
          {points.map((p, i) => (points.length - 1 - i) % labelEvery === 0 && (
            <text key={p.day} x={toX(i)} y={height - 10} textAnchor="middle" fontSize="10" fontWeight="600" fill={muted}>
              {i === points.length - 1 ? 'Today' : formatTrendDay(p.day)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

/* ── Zone row ─────────────────────────────────────────────────────────────── */
const RATING_META = {
  good:     { color: '#2fbf4f', label: 'GOOD'     },
  moderate: { color: '#f5a623', label: 'MODERATE' },
  poor:     { color: '#e0353b', label: 'POOR'     },
  // Only temporarily unavailable hydrants so far: nothing to rate yet.
  pending:  { color: STATUS_META.reference.color, label: 'PENDING' },
};

function ZoneRow({ name, checked, operational, pending, rating, selected, onClick }: ZoneStats & { selected: boolean; onClick: () => void }) {
  const meta = RATING_META[rating];
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 border-b border-neutral-100 px-2 py-2.5 text-left transition-colors last:border-0 dark:border-neutral-800 ${
        selected ? 'bg-red-50 dark:bg-red-950/30' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
        <div>
          <p className={`text-xs font-bold ${selected ? 'text-[#e0353b]' : 'text-neutral-800 dark:text-neutral-100'}`}>{name}</p>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {checked} checked · {operational} op{pending > 0 && ` · ${pending} pending`}
          </p>
        </div>
      </div>
      <span className="shrink-0">
        <PillBadge dot={meta.color} color={meta.color} label={meta.label} />
      </span>
    </button>
  );
}

/* ── Recent activity ──────────────────────────────────────────────────────────
   Surfaces the most recently touched hydrants by scanning each hydrant's
   maintenance register for its latest-dated entry, then sorting newest-first.
   "Initial inspection" entries naturally surface newly-added hydrants, while
   "Status update" entries surface edits — covering both added & updated. */
interface ActivityItem {
  hydrantId: string;
  name: string;
  area: string;
  action: string;
  by: string;
  date: string;
  status: HydrantStatus;
}

function computeRecentActivity(hydrants: Hydrant[], limit = 12): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const h of hydrants) {
    const dated = h.register.filter((r) => r.date);
    if (dated.length === 0) continue;
    const latest = dated.reduce((a, b) => (a.date > b.date ? a : b));
    items.push({
      hydrantId: h.id,
      name: h.name,
      area: h.area,
      action: latest.action,
      by: latest.by,
      date: latest.date,
      status: h.status,
    });
  }
  // ISO-style date strings sort lexically, newest first.
  return items
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

function formatActivityDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ActivityRow({
  item, expanded, onToggle, onFind,
}: { item: ActivityItem; expanded: boolean; onToggle: () => void; onFind: () => void }) {
  const { name, area, action, by, date, status } = item;
  const meta = STATUS_META[status];
  return (
    <div className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
          expanded ? 'bg-red-50 dark:bg-red-950/30' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
          <div className="min-w-0">
            <p className={`truncate text-xs font-bold ${expanded ? 'text-[#e0353b]' : 'text-neutral-800 dark:text-neutral-100'}`}>{name}</p>
            <p className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
              {action} · {by} · {area}
            </p>
          </div>
        </div>
        {/* Date under the pill keeps rows narrow enough for a side column. */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <PillBadge dot={meta.color} color={meta.color} label={meta.pillLabel} />
          <span className="text-[10px] font-medium text-neutral-400 tabular-nums dark:text-neutral-500">
            {formatActivityDate(date)}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="anim-fade-scale flex justify-end px-2 pb-2.5">
          <button
            onClick={onFind}
            className="flex items-center gap-1.5 rounded-lg bg-[#e0353b] px-3 py-1.5 text-[11px] font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.03] active:scale-[0.97] active:duration-75"
          >
            <PinGlyph /> Find in Map
          </button>
        </div>
      )}
    </div>
  );
}

function PinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/* ── Card wrapper ─────────────────────────────────────────────────────────── */
// `className` carries the display (flex/hidden) and grid placement; `scroll`
// lets a long list scroll inside the card when the grid caps its height.
function Card({ title, subtitle, className = 'flex', scroll = false, children }: {
  title: string; subtitle?: string; className?: string; scroll?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`${className} min-w-0 flex-col rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900`}>
      <div className="shrink-0 border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <h2 className="text-sm font-bold text-neutral-800 dark:text-neutral-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{subtitle}</p>}
      </div>
      <div className={`flex-1 px-4 py-3 ${scroll ? 'min-h-0 overflow-y-auto' : ''}`}>{children}</div>
    </section>
  );
}

/* ── Stat box ─────────────────────────────────────────────────────────────── */
function StatBox({ value, label, sub }: { value: number; label: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700">
      <span className="text-2xl font-extrabold tabular-nums text-[#e0353b] dark:text-[#e0353b]">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</span>
      {sub && <span className="text-[10px] text-neutral-400 dark:text-neutral-500">{sub}</span>}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
type OpsTab = 'overview' | 'trend' | 'zones' | 'activity';

const OPS_TABS: { id: OpsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'trend',    label: 'Trend' },
  { id: 'zones',    label: 'Zones' },
  { id: 'activity', label: 'Recent' },
];

export default function OperationsDashboard({ hydrants, reports, role, onClose, onFindOnMap }: Props) {
  const { user, accountType } = useAuth();
  const total = hydrants.length;
  const openReports = reports.filter(r => r.status === 'pending').length;
  // Temporarily unavailable (BFP reference) hydrants are excluded from these;
  // see app/src/data/operations-stats.ts.
  const breakdown  = useMemo(() => statusBreakdown(hydrants), [hydrants]);
  const compliance = useMemo(() => complianceStats(hydrants), [hydrants]);

  const zones    = useMemo(() => zoneStats(hydrants), [hydrants]);
  const trend    = useMemo(() => conditionTrend(hydrants), [hydrants]);
  const activity = useMemo(() => computeRecentActivity(hydrants), [hydrants]);
  const roleLabel = accountType === 'station' ? 'Station Account' : role === 'admin' ? 'Admin' : 'Head';

  // Selected zone drives the geographic drill-down (toggles off when re-tapped).
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const toggleZone = (zone: string) => setSelectedZone((prev) => (prev === zone ? null : zone));

  // Which recent-activity row is expanded to reveal its "Find in Map" action.
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null);

  // Below xl only the chosen tab's cards show; from xl everything does.
  const [tab, setTab] = useState<OpsTab>('overview');
  const shown = (id: OpsTab) => `${tab === id ? 'flex' : 'hidden'} xl:flex`;

  const displayName = user?.displayName
    || (user?.email ? user.email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'User');

  const s = {
    fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[6000] flex flex-col overflow-hidden">
      {/* Top header */}
      <header className="flex shrink-0 items-center justify-between gap-2 bg-white px-4 py-2.5 shadow-sm dark:bg-neutral-900 md:px-6 md:py-3">
        <Logo />
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <span className="truncate text-sm font-extrabold text-neutral-800 dark:text-neutral-100 md:text-base">Welcome, {displayName}</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0353b] text-white ring-2 ring-[#FED42E] md:h-9 md:w-9">
            <UserGlyph />
          </span>
        </div>
      </header>

      {/* Brand bar */}
      <div
        className="h-1 w-full shrink-0"
        style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #e0353b 70px, #e0353b 140px)' }}
      />

      {/* Sub-header */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900 md:flex-row md:items-center md:justify-between md:px-6 md:py-3">
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={onClose}
            title="Back to map"
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-neutral-400 transition-all duration-150 ease-out hover:bg-neutral-100 hover:text-[#e0353b] hover:scale-[1.04] active:scale-[0.96] active:duration-75 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-[#e0353b]"
          >
            <BackGlyph /> Map
          </button>
          <span className="hidden h-5 w-px bg-neutral-200 dark:bg-neutral-700 md:block" />
          <h1 className="min-w-0 flex-1 truncate text-base font-extrabold tracking-tight text-neutral-800 dark:text-neutral-100 md:flex-none md:text-lg">Operations Dashboard</h1>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#e0353b] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white md:px-3">
            <LockGlyph /> {roleLabel}
          </span>
        </div>
        <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 md:text-xs">
          <span className="font-bold text-neutral-600 dark:text-neutral-300">{total}</span> Hydrants
          <span className="mx-1.5">·</span>
          <span className="font-bold text-neutral-600 dark:text-neutral-300">{openReports}</span> Open Reports
          <span className="mx-1.5">·</span>
          <span className="font-bold text-neutral-600 dark:text-neutral-300">{compliance.obstructed}</span> Obstructed
        </p>
      </div>

      {/* Below xl: one tab at a time */}
      <nav aria-label="Dashboard sections" className="shrink-0 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 xl:hidden">
        <div role="tablist" className="flex gap-1.5 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {OPS_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                tab === id
                  ? 'bg-[#e0353b] text-white'
                  : 'bg-neutral-100 text-neutral-600 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* xl and up: everything on one screen — status, hazard and trend on top;
          zones and recent activity fill the rest and scroll inside their cards. */}
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto bg-neutral-100 p-3 dark:bg-neutral-950 md:p-4 xl:overflow-hidden">
        <div className="flex flex-col gap-3 xl:grid xl:h-full xl:grid-cols-12 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4">

          {/* Status Breakdown */}
          <Card className={`${shown('overview')} xl:col-span-4`} title="Status Breakdown" subtitle={`LIVE · ${breakdown.checked} CHECKED · ${breakdown.pending} PENDING CHECK`}>
            <DonutChart breakdown={breakdown} />
          </Card>

          {/* Hazard & Compliance — field-checked hydrants only */}
          <Card className={`${shown('overview')} xl:col-span-3`} title="Hazard & Compliance" subtitle="OBSTRUCTION · RA 9514 §8 · CHECKED">
            <div className="grid grid-cols-2 gap-2.5">
              <StatBox
                value={compliance.obstructed}
                label="Obstructed"
                sub={compliance.obstructedPct === null ? undefined : `${compliance.obstructedPct}% of checked`}
              />
              <StatBox value={openReports} label="Open Reports" />
              <StatBox
                value={compliance.verified}
                label="Verified"
                sub={breakdown.pending > 0 ? `${breakdown.pending} pending check` : undefined}
              />
              <StatBox value={compliance.compliant} label="Compliant" sub="checked, no obstruction" />
            </div>
          </Card>

          {/* Condition Trend */}
          <Card className={`${shown('trend')} xl:col-span-5`} title="Condition Trend" subtitle="WEEKLY · OPERATIONAL % OF CHECKED HYDRANTS">
            <TrendChart points={trend} height={160} />
          </Card>

          {/* Coverage by Zone */}
          <Card className={`${shown('zones')} min-h-0 xl:col-span-5`} scroll title="Coverage by Zone" subtitle="BY BARANGAY · OPERATIONAL OF CHECKED">
            {zones.length > 0 ? (
              <div className="flex flex-col">
                {zones.map(z => (
                  <ZoneRow
                    key={z.name}
                    {...z}
                    selected={selectedZone === z.name}
                    onClick={() => toggleZone(z.name)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">No zone data available.</p>
            )}
          </Card>

          {/* Recently Updated */}
          <Card className={`${shown('activity')} min-h-0 xl:col-span-7`} scroll title="Recently Updated" subtitle="LATEST REGISTER ACTIVITY · NEWEST FIRST">
            {activity.length > 0 ? (
              <div className="flex flex-col">
                {activity.map((a) => (
                  <ActivityRow
                    key={a.hydrantId}
                    item={a}
                    expanded={expandedActivity === a.hydrantId}
                    onToggle={() => setExpandedActivity((prev) => (prev === a.hydrantId ? null : a.hydrantId))}
                    onFind={() => onFindOnMap(a.hydrantId)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">No recent activity recorded.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Local helpers ────────────────────────────────────────────────────────── */

const stroke = {
  fill: 'none', stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Logo() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/Hydro-Scout%20Logo.png" alt="Hydro-Scout" width={44} height={44} className="h-9 w-9 object-contain md:h-11 md:w-11" />
      <span className="text-lg font-extrabold tracking-tight text-neutral-800 dark:text-neutral-100 md:text-xl">
        Hydro-<span className="text-[#e0353b]">Scout</span>
      </span>
    </div>
  );
}

function UserGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
