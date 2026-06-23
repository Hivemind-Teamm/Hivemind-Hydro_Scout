'use client';

import { useMemo } from 'react';
import { countByStatus, type Hydrant } from '../data/hydrants';
import { type Report } from '../data/reports';
import { type Role } from '@/lib/auth-context';

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
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);
}

/* ── Donut chart ──────────────────────────────────────────────────────────── */
function DonutChart({
  operational, reduced, out, total,
}: { operational: number; reduced: number; out: number; total: number }) {
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
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth="15" />
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
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="800" fill="#111827">
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
            <span className="text-neutral-500">{item.label}</span>
            <span className="ml-2 font-bold tabular-nums text-neutral-800">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Trend chart ──────────────────────────────────────────────────────────── */
function TrendChart({ currentPct }: { currentPct: number }) {
  const start = Math.max(currentPct - 14, 35);
  const pts = [
    start,
    start + (currentPct - start) * 0.18,
    start + (currentPct - start) * 0.44,
    start + (currentPct - start) * 0.72,
    currentPct,
  ];

  const W = 460;
  const H = 120;
  const PAD = { top: 16, right: 12, bottom: 28, left: 36 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const minY = Math.floor(Math.min(...pts) / 10) * 10 - 5;
  const maxY = Math.ceil(Math.max(...pts) / 10) * 10 + 5;

  const toX = (i: number) => PAD.left + (i / (pts.length - 1)) * cW;
  const toY = (v: number) => PAD.top + cH - ((v - minY) / (maxY - minY)) * cH;

  const pathD = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ');
  const areaD = `${pathD} L ${toX(pts.length - 1)} ${H - PAD.bottom} L ${toX(0)} ${H - PAD.bottom} Z`;
  const weeks = ['WK1', 'WK2', 'WK3', 'WK4', 'WK5'];

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {[25, 50, 75].filter(v => v >= minY && v <= maxY).map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)}
              stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 3" />
            <text x={PAD.left - 5} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#9ca3af">{v}%</text>
          </g>
        ))}
        <path d={areaD} fill="#91191E" opacity="0.06" />
        <path d={pathD} fill="none" stroke="#91191E" strokeWidth="2" strokeLinejoin="round" />
        {pts.map((v, i) => (
          <circle key={i} cx={toX(i)} cy={toY(v)} r="4" fill="#91191E" stroke="white" strokeWidth="1.5" />
        ))}
        {weeks.map((w, i) => (
          <text key={w} x={toX(i)} y={H - PAD.bottom + 13} textAnchor="middle" fontSize="9" fill="#9ca3af" fontWeight="600">
            {w}
          </text>
        ))}
      </svg>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
        <span className="mt-0.5 shrink-0">⚠</span>
        <span>Sample data — trend logging begins at deployment. Shown here to demonstrate the chart layout.</span>
      </div>
    </div>
  );
}

/* ── Zone row ─────────────────────────────────────────────────────────────── */
const RATING_META = {
  good:     { color: '#2fbf4f', bg: '#e6f9ec', label: 'GOOD'     },
  moderate: { color: '#f5a623', bg: '#fff4e0', label: 'MODERATE' },
  poor:     { color: '#91191E', bg: '#fce8e9', label: 'POOR'     },
};

function ZoneRow({ name, total, operational, rating }: ZoneData) {
  const meta = RATING_META[rating];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 py-2.5 last:border-0">
      <div className="flex items-center gap-2.5">
        <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
        <div>
          <p className="text-xs font-bold text-neutral-800">{name}</p>
          <p className="text-[11px] text-neutral-400">{total} hyd · {operational} op</p>
        </div>
      </div>
      <span
        className="shrink-0 rounded px-2 py-0.5 text-[10px] font-bold"
        style={{ color: meta.color, background: meta.bg }}
      >
        {meta.label}
      </span>
    </div>
  );
}

/* ── Card wrapper ─────────────────────────────────────────────────────────── */
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-5 py-3">
        <p className="text-sm font-bold text-neutral-800">{title}</p>
        {subtitle && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400">{subtitle}</p>}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
    </div>
  );
}

/* ── Stat box ─────────────────────────────────────────────────────────────── */
function StatBox({ value, label, sub }: { value: number; label: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 p-3">
      <span className="text-3xl font-extrabold tabular-nums text-[#91191E]">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</span>
      {sub && <span className="text-[10px] text-neutral-400">{sub}</span>}
    </div>
  );
}

/* ── Admin action button ──────────────────────────────────────────────────── */
function AdminAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-neutral-700 transition-colors hover:border-[#91191E] hover:bg-red-50 hover:text-[#91191E]">
      <span className="shrink-0 text-neutral-400 group-hover:text-[#91191E]">{icon}</span>
      {label}
    </button>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export default function OperationsDashboard({ hydrants, reports, role, onClose }: Props) {
  const counts = useMemo(() => countByStatus(hydrants), [hydrants]);
  const total = hydrants.length;
  const operationalPct = total > 0 ? Math.round((counts.operational / total) * 100) : 0;
  const openReports  = reports.filter(r => r.status === 'pending').length;
  const obstructed   = hydrants.filter(h => h.hazard && !['None', '—', '', 'none'].includes(h.hazard)).length;
  const verified     = hydrants.filter(h => h.register.length > 0).length;

  const zones   = useMemo(() => computeZones(hydrants), [hydrants]);
  const isAdmin = role === 'admin';
  const roleLabel = role === 'admin' ? 'Admin' : 'Head';

  const s = {
    fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[6000] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between bg-[#91191E] px-8 py-4 shadow-lg">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-300">
            QC Central Fire District · {roleLabel}
          </p>
          <h1 className="text-xl font-extrabold uppercase tracking-wide text-white">
            Operations Dashboard
          </h1>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/40 px-4 py-2 text-xs font-bold text-red-200 transition-colors hover:bg-red-800 hover:text-white"
        >
          ← Back to Map
        </button>
      </div>

      {/* Brand bar */}
      <div
        className="h-1 w-full shrink-0"
        style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #91191E 70px, #91191E 140px)' }}
      />

      {/* Grid body */}
      <div className="grid flex-1 grid-cols-3 gap-4 overflow-y-auto bg-neutral-100 p-6">

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
            <div className="flex flex-col">
              {zones.map(z => <ZoneRow key={z.name} {...z} />)}
            </div>
          ) : (
            <p className="text-xs text-neutral-400">No zone data available.</p>
          )}
        </Card>

        {/* Condition Trend */}
        <div className="col-span-2">
          <Card title="Condition Trend" subtitle="OPERATIONAL % OVER TIME">
            <TrendChart currentPct={operationalPct} />
          </Card>
        </div>

        {/* Administration */}
        <Card title="Administration" subtitle="ADMIN ONLY">
          {isAdmin ? (
            <div className="flex flex-col gap-2">
              <AdminAction
                label="Manage Users & Roles"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" {...s}>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                }
              />
              <AdminAction
                label="Bulk-Import Hydrants · CSV"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" {...s}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                }
              />
              <AdminAction
                label="Data Quality & Validation"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" {...s}>
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                }
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <svg width="28" height="28" viewBox="0 0 24 24" {...s} className="text-neutral-300">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <p className="text-xs font-bold text-neutral-500">Admin access required</p>
              <p className="text-[11px] text-neutral-400">
                These tools are restricted to system administrators.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
