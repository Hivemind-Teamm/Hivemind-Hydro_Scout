'use client';

import { useMemo, useState } from 'react';
import { countByStatus, STATUS_META, type Hydrant } from '../data/hydrants';
import { type Report } from '../data/reports';
import { useAuth, type Role } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

interface Props {
  hydrants: Hydrant[];
  reports: Report[];
  role: Role;
  onClose: () => void;
}

/* ── Zone computation ─────────────────────────────────────────────────────── */
interface ZoneData {
  name: string;
  total: number;
  operational: number;
  rating: 'good' | 'moderate' | 'poor';
}

function computeZones(hydrants: Hydrant[]): ZoneData[] {
  const map = new Map<string, { total: number; operational: number }>();
  for (const h of hydrants) {
    const area = h.area || 'Unknown';
    const entry = map.get(area) ?? { total: 0, operational: 0 };
    entry.total++;
    if (h.status === 'operational') entry.operational++;
    map.set(area, entry);
  }
  return Array.from(map.entries())
    .map(([name, { total, operational }]) => {
      const pct = total > 0 ? operational / total : 0;
      const rating: 'good' | 'moderate' | 'poor' =
        pct >= 0.75 ? 'good' : pct >= 0.5 ? 'moderate' : 'poor';
      return { name, total, operational, rating };
    })
    .sort((a, b) => b.total - a.total);
}

/* ── Trend computation ────────────────────────────────────────────────────── */
function computeTrendData(hydrants: Hydrant[]): { points: number[]; labels: string[] } {
  const now = new Date();
  const weeks = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (4 - i) * 7);
    return d;
  });

  const points = weeks.map(weekEnd => {
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    let operational = 0;
    let counted = 0;
    for (const h of hydrants) {
      counted++;
      const before = h.register.filter(r => r.date && r.date <= weekEndStr);
      if (before.length === 0) {
        if (h.status === 'operational') operational++;
      } else {
        const latest = before.reduce((a, b) => (a.date > b.date ? a : b));
        if (latest.statusColor === '#2fbf4f') operational++;
      }
    }
    return counted > 0 ? Math.round((operational / counted) * 100) : 0;
  });

  const labels = weeks.map(d =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );

  return { points, labels };
}

/* ── Donut chart ──────────────────────────────────────────────────────────── */
function DonutChart({
  operational, reduced, out, total,
}: { operational: number; reduced: number; out: number; total: number }) {
  const { isDark } = useTheme();
  const r = 40;
  const cx = 56;
  const cy = 56;
  const circumference = 2 * Math.PI * r;
  const operationalPct = total > 0 ? Math.round((operational / total) * 100) : 0;

  const segs = [
    { color: '#2fbf4f', count: operational },
    { color: '#f5a623', count: reduced },
    { color: '#9aa0a6', count: out },
  ];

  let cumulativeAngle = -90;
  const arcs = segs.map(seg => {
    const pct = total > 0 ? seg.count / total : 0;
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
          {operationalPct}%
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#9ca3af" letterSpacing="0.8">
          OPERATIONAL
        </text>
      </svg>

      <div className="flex flex-col gap-2.5 text-xs">
        {[
          { color: '#2fbf4f', label: 'Operational',   value: operational },
          { color: '#f5a623', label: 'Reduced PSI',    value: reduced    },
          { color: '#9aa0a6', label: 'Out of service', value: out        },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} />
            <span className="text-neutral-500 dark:text-neutral-400">{item.label}</span>
            <span className="ml-2 font-bold tabular-nums text-neutral-800 dark:text-neutral-100">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Trend chart ──────────────────────────────────────────────────────────── */
function TrendChart({ points, labels }: { points: number[]; labels: string[] }) {
  const { isDark } = useTheme();

  const W = 460;
  const H = 120;
  const PAD = { top: 16, right: 12, bottom: 28, left: 36 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const minY = Math.max(0, Math.floor(Math.min(...points) / 10) * 10 - 5);
  const maxY = Math.min(100, Math.ceil(Math.max(...points) / 10) * 10 + 5);
  const range = maxY - minY || 1;

  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * cW;
  const toY = (v: number) => PAD.top + cH - ((v - minY) / range) * cH;

  const pathD = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ');
  const areaD = `${pathD} L ${toX(points.length - 1)} ${H - PAD.bottom} L ${toX(0)} ${H - PAD.bottom} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      {[25, 50, 75].filter(v => v >= minY && v <= maxY).map(v => (
        <g key={v}>
          <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)}
            stroke={isDark ? '#374151' : '#e5e7eb'} strokeWidth="1" strokeDasharray="4 3" />
          <text x={PAD.left - 5} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#9ca3af">{v}%</text>
        </g>
      ))}
      <path d={areaD} fill="#e0353b" opacity={isDark ? 0.18 : 0.06} />
      <path d={pathD} fill="none" stroke={isDark ? '#e0353b' : '#e0353b'} strokeWidth="2" strokeLinejoin="round" />
      {points.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r="4" fill={isDark ? '#e0353b' : '#e0353b'} stroke={isDark ? '#0b0f14' : 'white'} strokeWidth="1.5" />
      ))}
      {labels.map((w, i) => (
        <text key={w} x={toX(i)} y={H - PAD.bottom + 13} textAnchor="middle" fontSize="9" fill="#9ca3af" fontWeight="600">
          {w}
        </text>
      ))}
    </svg>
  );
}

/* ── Zone row ─────────────────────────────────────────────────────────────── */
const RATING_META = {
  good:     { color: '#2fbf4f', bg: '#e6f9ec', label: 'GOOD'     },
  moderate: { color: '#f5a623', bg: '#fff4e0', label: 'MODERATE' },
  poor:     { color: '#e0353b', bg: '#fce8e9', label: 'POOR'     },
};

function ZoneRow({ name, total, operational, rating, selected, onClick }: ZoneData & { selected: boolean; onClick: () => void }) {
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
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{total} hyd · {operational} op</p>
        </div>
      </div>
      <span
        className="shrink-0 rounded px-2 py-0.5 text-[10px] font-bold"
        style={{ color: meta.color, background: meta.bg }}
      >
        {meta.label}
      </span>
    </button>
  );
}

/* ── Geographic performance map ───────────────────────────────────────────────
   Lightweight SVG scatter of every hydrant positioned by lat/lng (no Mapbox
   needed inside the dashboard). Dots are coloured by operational status; the
   selected zone is highlighted while the rest dim, giving a geographic
   drill-down that stays in sync with the zone list. */
function GeoPerformanceMap({
  hydrants, selectedZone, onSelectZone,
}: { hydrants: Hydrant[]; selectedZone: string | null; onSelectZone: (zone: string) => void }) {
  const { isDark } = useTheme();
  // Hydrant tapped on the map — drives the mini-detail card below it.
  const [activeId, setActiveId] = useState<string | null>(null);
  const W = 800;
  const H = 300;
  const PAD = 24;

  const pts = useMemo(() => {
    const valid = hydrants.filter((h) => h.lat !== 0 || h.lng !== 0);
    if (valid.length === 0) return [];
    const lats = valid.map((h) => h.lat);
    const lngs = valid.map((h) => h.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latRange = maxLat - minLat || 1;
    const lngRange = maxLng - minLng || 1;
    return valid.map((h) => ({
      id: h.id,
      hydrant: h,
      area: h.area || 'Unknown',
      color: STATUS_META[h.status].color,
      // lng → x (east-right); lat → y (north-up, so invert)
      x: PAD + ((h.lng - minLng) / lngRange) * (W - PAD * 2),
      y: PAD + (1 - (h.lat - minLat) / latRange) * (H - PAD * 2),
    }));
  }, [hydrants]);

  const active = activeId ? pts.find((p) => p.id === activeId)?.hydrant ?? null : null;

  if (pts.length === 0) {
    return <p className="text-xs text-neutral-400 dark:text-neutral-500">No geographic data available.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="rounded-lg" style={{ background: isDark ? '#0b0f14' : '#f8fafc' }}>
        {/* subtle grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1={PAD + f * (W - PAD * 2)} y1={PAD} x2={PAD + f * (W - PAD * 2)} y2={H - PAD} stroke={isDark ? '#1f2937' : '#e5e7eb'} strokeWidth="1" />
            <line x1={PAD} y1={PAD + f * (H - PAD * 2)} x2={W - PAD} y2={PAD + f * (H - PAD * 2)} stroke={isDark ? '#1f2937' : '#e5e7eb'} strokeWidth="1" />
          </g>
        ))}
        {pts.map((p, i) => {
          const dim = selectedZone !== null && p.area !== selectedZone;
          const isActive = p.id === activeId;
          const zoneHot = selectedZone !== null && p.area === selectedZone;
          return (
            <circle
              key={`${p.id}-${i}`}
              cx={p.x} cy={p.y}
              r={isActive ? 7 : zoneHot ? 6 : 4}
              fill={p.color}
              fillOpacity={dim && !isActive ? 0.15 : 0.9}
              stroke={isActive ? '#e0353b' : zoneHot ? (isDark ? '#fff' : '#111827') : 'none'}
              strokeWidth={isActive ? 2.5 : zoneHot ? 1.5 : 0}
              style={{ cursor: 'pointer', transition: 'r 0.15s, fill-opacity 0.15s' }}
              onClick={() => setActiveId(p.id)}
            >
              <title>{`${p.id} · ${p.hydrant.name}`}</title>
            </circle>
          );
        })}
      </svg>

      {/* Mini detail card for the tapped hydrant */}
      {active && (
        <div className="anim-fade-scale flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
          <span className="mt-0.5 h-8 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_META[active.status].color }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-neutral-400 dark:text-neutral-500">{active.id}</span>
              <span className="truncate text-sm font-bold text-neutral-800 dark:text-neutral-100">{active.name}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="font-bold" style={{ color: STATUS_META[active.status].color }}>{STATUS_META[active.status].legendLabel}</span>
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
              <span className="text-neutral-600 dark:text-neutral-300">Pressure: <span className="font-semibold">{active.pressure}</span></span>
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
              <span className="text-neutral-600 dark:text-neutral-300">{active.area}</span>
              {active.hazard && active.hazard !== 'None' && (
                <>
                  <span className="text-neutral-400 dark:text-neutral-500">·</span>
                  <span className="font-semibold text-[#f5a623]">⚠ {active.hazard}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => setActiveId(null)}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {[
          { color: '#2fbf4f', label: 'Operational' },
          { color: '#f5a623', label: 'Reduced PSI' },
          { color: '#9aa0a6', label: 'Out of service' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
        {selectedZone && (
          <button
            onClick={() => { onSelectZone(selectedZone); setActiveId(null); }}
            className="ml-auto rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-bold text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {selectedZone} · clear ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Card wrapper ─────────────────────────────────────────────────────────── */
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800 md:px-5">
        <p className="text-sm font-bold text-neutral-800 dark:text-neutral-100">{title}</p>
        {subtitle && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{subtitle}</p>}
      </div>
      <div className="flex-1 px-4 py-3.5 md:px-5 md:py-4">{children}</div>
    </div>
  );
}

/* ── Stat box ─────────────────────────────────────────────────────────────── */
function StatBox({ value, label, sub }: { value: number; label: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <span className="text-3xl font-extrabold tabular-nums text-[#e0353b] dark:text-[#e0353b]">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</span>
      {sub && <span className="text-[10px] text-neutral-400 dark:text-neutral-500">{sub}</span>}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export default function OperationsDashboard({ hydrants, reports, role, onClose }: Props) {
  const { user } = useAuth();
  const counts = useMemo(() => countByStatus(hydrants), [hydrants]);
  const total = hydrants.length;
  const openReports  = reports.filter(r => r.status === 'pending').length;
  const obstructed   = hydrants.filter(h => h.hazard && !['None', '—', '', 'none'].includes(h.hazard)).length;
  const verified     = hydrants.filter(h => h.register.length > 0).length;

  const zones   = useMemo(() => computeZones(hydrants), [hydrants]);
  const trend   = useMemo(() => computeTrendData(hydrants), [hydrants]);
  const roleLabel = role === 'admin' ? 'Admin' : 'Head';

  // Selected zone drives the geographic drill-down (toggles off when re-tapped).
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const toggleZone = (zone: string) => setSelectedZone((prev) => (prev === zone ? null : zone));

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
          <span className="font-bold text-neutral-600 dark:text-neutral-300">{obstructed}</span> Obstructed
        </p>
      </div>

      {/* Grid body */}
      <div className="scroll-fade grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto bg-neutral-100 p-3 dark:bg-neutral-950 md:grid-cols-3 md:gap-4 md:p-6">

        {/* Status Breakdown */}
        <Card title="Status Breakdown" subtitle={`LIVE · ${total} HYDRANTS IN AOR`}>
          <DonutChart
            operational={counts.operational}
            reduced={counts.reduced}
            out={counts.out}
            total={total}
          />
        </Card>

        {/* Hazard & Compliance */}
        <Card title="Hazard & Compliance" subtitle="OBSTRUCTION · RA 9514 §8">
          <div className="grid grid-cols-2 gap-3">
            <StatBox
              value={obstructed}
              label="Obstructed"
              sub={total > 0 ? `${Math.round((obstructed / total) * 100)}%` : undefined}
            />
            <StatBox value={openReports} label="Open Reports" />
            <StatBox value={verified}    label="Verified"     />
            <StatBox value={total - obstructed} label="Compliant" />
          </div>
        </Card>

        {/* Coverage by Zone */}
        <Card title="Coverage by Zone" subtitle="TAP ZONE · OPERATIONAL COUNT">
          {zones.length > 0 ? (
            <div className="flex max-h-64 flex-col overflow-y-auto">
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

        {/* Geographic Performance Map */}
        <div className="md:col-span-3">
          <Card title="Geographic Performance Map" subtitle="TAP A HYDRANT FOR DETAILS · STATUS BY LOCATION">
            <GeoPerformanceMap
              hydrants={hydrants}
              selectedZone={selectedZone}
              onSelectZone={toggleZone}
            />
          </Card>
        </div>

        {/* Condition Trend */}
        <div className="md:col-span-3">
          <Card title="Condition Trend" subtitle="OPERATIONAL % OVER TIME">
            <TrendChart points={trend.points} labels={trend.labels} />
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
