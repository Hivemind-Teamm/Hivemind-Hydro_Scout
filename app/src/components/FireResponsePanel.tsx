'use client';

import { FiAlertTriangle, FiChevronDown, FiInfo, FiMove, FiX } from 'react-icons/fi';
import { MdCenterFocusStrong, MdFireTruck, MdLocalFireDepartment, MdWaterDrop } from 'react-icons/md';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import { formatDistance } from '@/lib/haversine';
import { estimateSupplyLine, type FireHydrantCandidate } from '@/lib/fire-response';

interface FireResponsePanelProps {
  lat: number;
  lng: number;
  /** Reverse-geocoded address; null while it is still being looked up. */
  address: string | null;
  radiusM: number;
  /** Hydrants inside the radius, closest first. */
  candidates: FireHydrantCandidate[];
  /** Closest hydrant outside the radius — shown when none are inside. */
  nearestOutside: FireHydrantCandidate | null;
  /** Hydrant the supply line is drawn from. */
  supply: FireHydrantCandidate | null;
  /** Hydrant feed still loading — the list isn't meaningful yet. */
  loading: boolean;
  maxHeight: string;
  onSelectSupply: (hydrantId: string) => void;
  onViewHydrant: (hydrant: Hydrant) => void;
  onRecenter: () => void;
  onMovePin: () => void;
  onClear: () => void;
  /** Mobile only — collapses the panel to an edge tab. */
  onMinimize?: () => void;
}

export default function FireResponsePanel({
  lat, lng, address, radiusM, candidates, nearestOutside, supply, loading, maxHeight,
  onSelectSupply, onViewHydrant, onRecenter, onMovePin, onClear, onMinimize,
}: FireResponsePanelProps) {
  const operationalCount = candidates.filter((c) => c.hydrant.status === 'operational').length;
  const radiusLabel = formatDistance(radiusM);

  return (
    <div
      className="anim-fade-scale pointer-events-auto flex w-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_rgba(0,0,0,0.25)] dark:bg-neutral-900 dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      style={{ maxHeight }}
    >
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-start gap-2.5 px-3.5 py-3 text-white"
        style={{ background: 'linear-gradient(135deg, #e0353b 0%, #f97316 100%)' }}
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
          <MdLocalFireDepartment className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75">Fire Incident</p>
          <p className={`truncate text-sm font-bold leading-snug ${address === null ? 'italic text-white/70' : ''}`} title={address ?? undefined}>
            {address ?? 'Locating address…'}
          </p>
          <p className="font-mono text-[10px] text-white/70">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <HeaderButton label="Show whole radius" onClick={onRecenter}>
            <MdCenterFocusStrong className="h-4 w-4" />
          </HeaderButton>
          {onMinimize ? (
            <HeaderButton label="Minimize" onClick={onMinimize}>
              <FiChevronDown className="h-4 w-4" strokeWidth={2.5} />
            </HeaderButton>
          ) : (
            <HeaderButton label="Clear fire pin" onClick={onClear}>
              <FiX className="h-4 w-4" strokeWidth={2.5} />
            </HeaderButton>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Summary */}
        <div className="grid grid-cols-3 divide-x divide-neutral-100 border-b border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
          <Stat value={loading ? '…' : String(candidates.length)} label="In radius" />
          <Stat value={loading ? '…' : String(operationalCount)} label="Operational" accent={operationalCount > 0 ? STATUS_META.operational.color : undefined} />
          <Stat value={radiusLabel} label="Radius" />
        </div>

        {supply && <SupplyEstimate supply={supply} onViewHydrant={onViewHydrant} />}

        {/* Hydrant list */}
        <div className="px-3.5 pb-1 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            Hydrants within {radiusLabel}
          </p>
          {candidates.length > 1 && (
            <p className="mt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">Tap one to run the supply line from it.</p>
          )}
        </div>

        {loading ? (
          <p className="px-3.5 py-3 text-xs italic text-neutral-400 dark:text-neutral-500">Loading hydrants…</p>
        ) : candidates.length === 0 ? (
          <div className="px-3.5 pb-4 pt-2 text-center">
            <FiAlertTriangle className="mx-auto mb-1.5 h-6 w-6 text-amber-500" />
            <p className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">No hydrants within {radiusLabel}</p>
            {nearestOutside ? (
              <button
                onClick={() => onViewHydrant(nearestOutside.hydrant)}
                className="mt-1 text-[11px] text-neutral-500 hover:underline dark:text-neutral-400"
              >
                Nearest is <span className="font-semibold text-neutral-700 dark:text-neutral-200">{nearestOutside.hydrant.name}</span>, {formatDistance(nearestOutside.distanceM)} away →
              </button>
            ) : (
              <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">There are no hydrants on record.</p>
            )}
          </div>
        ) : (
          <ul className="pb-1">
            {candidates.map((c, index) => {
              const meta = STATUS_META[c.hydrant.status];
              const selected = supply?.hydrant.id === c.hydrant.id;
              return (
                <li key={c.hydrant.id}>
                  <button
                    onClick={() => onSelectSupply(c.hydrant.id)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-2.5 border-l-2 px-3.5 py-2 text-left transition-colors ${
                      selected
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
                        : 'border-transparent hover:bg-neutral-50 active:bg-neutral-100 dark:hover:bg-neutral-800 dark:active:bg-neutral-700'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${
                      selected ? 'bg-sky-500 text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300'
                    }`}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">{c.hydrant.name}</span>
                      <span className="flex items-center gap-1.5 text-[10px]">
                        <span className="font-mono text-neutral-400 dark:text-neutral-500">{c.hydrant.id}</span>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                        <span className="truncate font-semibold" style={{ color: meta.color }}>{meta.pillLabel}</span>
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs font-bold tabular-nums ${selected ? 'text-sky-600 dark:text-sky-400' : 'text-neutral-600 dark:text-neutral-300'}`}>
                      {formatDistance(c.distanceM)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex shrink-0 gap-2 border-t border-neutral-100 px-3.5 py-2.5 dark:border-neutral-800">
        <button
          onClick={onMovePin}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <FiMove className="h-3.5 w-3.5" /> Move pin
        </button>
        <button
          onClick={onClear}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-neutral-800 py-1.5 text-xs font-bold text-white hover:bg-neutral-700 dark:bg-neutral-700 dark:hover:bg-neutral-600"
        >
          <FiX className="h-3.5 w-3.5" strokeWidth={2.5} /> Clear fire
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function SupplyEstimate({ supply, onViewHydrant }: { supply: FireHydrantCandidate; onViewHydrant: (h: Hydrant) => void }) {
  const { hydrant, distanceM } = supply;
  const meta = STATUS_META[hydrant.status];
  const estimate = estimateSupplyLine(distanceM);
  const ready = estimate.status === 'ready';

  return (
    <div className="border-b border-neutral-100 px-3.5 py-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">Supply Line</p>
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
          <span className="text-sm font-extrabold tabular-nums text-sky-600 dark:text-sky-400">{formatDistance(distanceM)}</span> straight-line
        </p>
      </div>

      <button
        onClick={() => onViewHydrant(hydrant)}
        className="group mb-2.5 flex w-full items-center gap-2 rounded-lg bg-neutral-50 px-2.5 py-2 text-left hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        title="Open hydrant details"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-neutral-800 dark:text-neutral-100">{hydrant.name}</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px]">
            <span className="shrink-0 font-mono text-neutral-400 dark:text-neutral-500">{hydrant.id}</span>
            <span className="shrink-0 font-semibold" style={{ color: meta.color }}>{meta.legendLabel}</span>
            <span className="min-w-0 truncate text-neutral-400 dark:text-neutral-500">· {hydrant.pressure} pressure</span>
          </span>
        </span>
        <span className="shrink-0 text-[11px] font-semibold text-[#e0353b] group-hover:underline">Details →</span>
      </button>

      {hydrant.status !== 'operational' && (
        <p className="mb-2.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <FiAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          This hydrant is {meta.legendLabel.toLowerCase()} — it may not deliver enough water.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <EstimateTile
          icon={<MdFireTruck className="h-4 w-4" />}
          label="Fire trucks"
          value={ready ? String(estimate.fireTrucks) : null}
        />
        <EstimateTile
          icon={<MdWaterDrop className="h-4 w-4" />}
          label="Hose sections"
          value={ready ? String(estimate.hoseSections) : null}
          detail={ready ? `${formatDistance(estimate.hoseLengthM)} of hose` : undefined}
        />
      </div>

      {!ready && (
        <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug text-neutral-400 dark:text-neutral-500">
          <FiInfo className="mt-px h-3 w-3 shrink-0" />
          Truck and hose counts will appear once the calculation data is configured.
        </p>
      )}
    </div>
  );
}

function EstimateTile({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | null; detail?: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 px-2.5 py-2 dark:border-neutral-800">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {icon} {label}
      </p>
      {value !== null ? (
        <>
          <p className="mt-0.5 text-lg font-extrabold leading-tight tabular-nums text-neutral-800 dark:text-neutral-100">{value}</p>
          {detail && <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{detail}</p>}
        </>
      ) : (
        <>
          <p className="mt-0.5 text-lg font-extrabold leading-tight text-neutral-300 dark:text-neutral-600">—</p>
          <span className="inline-block rounded-full bg-neutral-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            Pending data
          </span>
        </>
      )}
    </div>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="px-2 py-2 text-center">
      <p className="text-base font-extrabold leading-tight tabular-nums text-neutral-800 dark:text-neutral-100" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</p>
    </div>
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white active:bg-white/30"
    >
      {children}
    </button>
  );
}
