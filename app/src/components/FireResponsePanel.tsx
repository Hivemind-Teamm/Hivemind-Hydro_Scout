'use client';

import { Fragment, type Ref } from 'react';
import { FiAlertTriangle, FiChevronDown, FiChevronRight, FiInfo, FiMove, FiX } from 'react-icons/fi';
import { MdCenterFocusStrong, MdFireTruck, MdLocalFireDepartment, MdWaterDrop } from 'react-icons/md';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import { formatDistance } from '@/lib/haversine';
import type { FireHydrantCandidate } from '@/lib/fire-response';
import { supplyStages } from '@/lib/supply-layout';
import type { SupplyLineEstimate } from '@/lib/supply-line';
import type { SupplyLine } from '@/lib/use-supply-line';

type ReadyEstimate = Extract<SupplyLineEstimate, { status: 'ready' }>;

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
  /** Hose and truck estimate for that supply line. */
  estimate: SupplyLineEstimate | null;
  /** Whether the hose route has been looked up yet. */
  routing: SupplyLine['routing'];
  /** Hydrant feed still loading — the list isn't meaningful yet. */
  loading: boolean;
  maxHeight: string;
  onSelectSupply: (hydrantId: string) => void;
  onViewHydrant: (hydrant: Hydrant) => void;
  onRecenter: () => void;
  onMovePin: () => void;
  onClear: () => void;
  canEdit?: boolean;
  onDismiss?: () => void;
  responseActionRef?: Ref<HTMLDivElement>;
  /** Mobile only — collapses the panel to an edge tab. */
  onMinimize?: () => void;
}

export default function FireResponsePanel({
  lat, lng, address, radiusM, candidates, nearestOutside, supply, estimate, routing, loading, maxHeight,
  onSelectSupply, onViewHydrant, onRecenter, onMovePin, onClear, onMinimize, responseActionRef, canEdit = true, onDismiss,
}: FireResponsePanelProps) {
  const operationalCount = candidates.filter((c) => c.hydrant.status === 'operational').length;
  const radiusLabel = formatDistance(radiusM);

  return (
    <div
      className="anim-fade-scale pointer-events-auto flex w-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_rgba(0,0,0,0.25)] dark:bg-neutral-900 dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      style={{ maxHeight }}
    >
      {/* ── Header ── */}
      <div className="flex shrink-0 items-start gap-2.5 bg-[#e0353b] px-3.5 py-3 text-white">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
          <MdLocalFireDepartment className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75">Shared Fire Incident</p>
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
            <HeaderButton label="Close fire details" onClick={onDismiss ?? onClear}>
              <FiX className="h-4 w-4" strokeWidth={2.5} />
            </HeaderButton>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {supply && <SupplyEstimate supply={supply} estimate={estimate} routing={routing} onViewHydrant={onViewHydrant} />}

        {/* Hydrant list */}
        <div className="flex items-baseline justify-between gap-2 px-3.5 pb-1 pt-3">
          <SectionLabel>Hydrants within {radiusLabel}</SectionLabel>
          {!loading && candidates.length > 0 && (
            <p className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
              {candidates.length} in range ·{' '}
              <span className="font-semibold" style={operationalCount > 0 ? { color: STATUS_META.operational.color } : undefined}>
                {operationalCount} operational
              </span>
            </p>
          )}
        </div>
        {candidates.length > 1 && (
          <p className="px-3.5 pb-1 text-[10px] text-neutral-400 dark:text-neutral-500">Tap one to run the supply line from it.</p>
        )}

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
          <ul className="pb-1.5">
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
          disabled={!canEdit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <FiMove className="h-3.5 w-3.5" /> Move pin
        </button>
        <button
          onClick={onClear}
          disabled={!canEdit}
          title="Clear this incident from all signed-in maps"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-neutral-800 py-1.5 text-xs font-bold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-700 dark:hover:bg-neutral-600"
        >
          <FiX className="h-3.5 w-3.5" strokeWidth={2.5} /> Clear fire
        </button>
        <div ref={responseActionRef} className="contents" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function SupplyEstimate({ supply, estimate, routing, onViewHydrant }: {
  supply: FireHydrantCandidate;
  estimate: SupplyLineEstimate | null;
  routing: SupplyLine['routing'];
  onViewHydrant: (h: Hydrant) => void;
}) {
  const { hydrant, distanceM } = supply;
  const meta = STATUS_META[hydrant.status];
  const ready = estimate?.status === 'ready' ? estimate : null;
  // Until a routing service answers, the hose length is a straight-line estimate.
  const routed = ready !== null && ready.distance.source !== 'straight-line';

  return (
    <div className="border-b border-neutral-100 px-3.5 pb-3.5 pt-3 dark:border-neutral-800">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Supply line</SectionLabel>
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
          <span className="text-sm font-extrabold tabular-nums text-sky-600 dark:text-sky-400">
            {ready && !routed && '~'}{formatDistance(ready ? ready.hoseLengthM : distanceM)}
          </span>{' '}
          {routed ? 'routed' : ready ? 'estimated' : 'straight-line'}
        </p>
      </div>

      {ready && <SupplyDiagram estimate={ready} estimated={!routed} />}

      <div className="mt-3 grid grid-cols-2 divide-x divide-neutral-100 dark:divide-neutral-800">
        <Count
          label="Fire trucks"
          value={ready?.fireTrucks}
          detail={ready && [
            `${ready.trucks.pumperAtHydrant} at hydrant`,
            `${ready.trucks.relayPumpers} relay`,
            `${ready.trucks.engineAtFire} at fire`,
          ]}
        />
        <Count
          label="Hose sections"
          value={ready?.hoseSections}
          detail={ready && ready.hose.sections.filter((size) => size.count > 0).map((size) => `${size.count} × ${size.lengthFt} ft`)}
          inset
        />
      </div>

      {ready && !routed && (
        <Note tone={routing === 'failed' ? 'warn' : 'muted'}>
          {routing === 'failed'
            ? 'No route found. Counts are estimated from the straight-line distance.'
            : 'Finding the hose route. Counts may change.'}
        </Note>
      )}
      {!ready && <Note tone="muted">Truck and hose counts will appear once the calculation data is configured.</Note>}

      <button
        onClick={() => onViewHydrant(hydrant)}
        className="group mt-3 flex w-full items-center gap-2.5 rounded-lg bg-neutral-50 px-2.5 py-2 text-left transition-colors hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        title="Open hydrant details"
      >
        <MdWaterDrop className="h-4 w-4 shrink-0 text-sky-500" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-neutral-800 dark:text-neutral-100">{hydrant.name}</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px]">
            <span className="shrink-0 font-mono text-neutral-400 dark:text-neutral-500">{hydrant.id}</span>
            <span className="shrink-0 font-semibold" style={{ color: meta.color }}>{meta.legendLabel}</span>
            <span className="min-w-0 truncate text-neutral-400 dark:text-neutral-500">· {hydrant.pressure} pressure</span>
          </span>
        </span>
        <FiChevronRight className="h-4 w-4 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5" />
      </button>

      {hydrant.status !== 'operational' && (
        <Note tone="warn" icon={<FiAlertTriangle className="mt-px h-3 w-3 shrink-0" />}>
          This hydrant is {meta.legendLabel.toLowerCase()} — it may not deliver enough water.
        </Note>
      )}
    </div>
  );
}

/**
 * The supply line drawn left to right: hydrant and its pumper, each hose
 * stage (to scale) with a relay pumper between stages, then the engine at the
 * fire. Dashed hose means the length is still a straight-line estimate.
 */
function SupplyDiagram({ estimate, estimated }: { estimate: ReadyEstimate; estimated: boolean }) {
  const stages = supplyStages(estimate);
  const relays = estimate.trucks.relayPumpers;
  const summary = `Hydrant, ${estimate.fireTrucks} fire trucks and ${stages.length} hose ${stages.length === 1 ? 'stage' : 'stages'} to the fire`;
  const collapsed = stages.length > 4;

  return (
    <div className="mt-2.5" role="img" aria-label={summary}>
      <div className={`flex items-center ${collapsed ? '' : 'pb-4'}`}>
        <DiagramNode kind="hydrant" />
        <DiagramNode kind="truck" />
        {collapsed ? (
          <>
            <Hose estimated={estimated} />
            <DiagramNode kind="truck" />
            <span className="ml-0.5 text-[10px] font-bold tabular-nums text-[#e0353b]">×{relays}</span>
            <Hose estimated={estimated} />
          </>
        ) : stages.map((meters, i) => (
          <Fragment key={i}>
            {i > 0 && <DiagramNode kind="truck" />}
            <Hose estimated={estimated} meters={meters} />
          </Fragment>
        ))}
        <DiagramNode kind="truck" />
        <DiagramNode kind="fire" />
      </div>
      {collapsed && (
        <p className="mt-1 text-center text-[9px] font-semibold text-neutral-400 dark:text-neutral-500">
          {relays} relay pumpers · {stages.length} stages of up to {formatDistance(estimate.stageLengthM)}
        </p>
      )}
    </div>
  );
}

/** One hose stage, as wide as its share of the line, labelled with its length when given. */
function Hose({ estimated, meters }: { estimated: boolean; meters?: number }) {
  return (
    <span className="relative mx-1 min-w-4" style={{ flex: `${Math.max(meters ?? 1, 1)} 1 0` }}>
      <span className={`block w-full ${estimated ? 'border-t-[3px] border-dashed border-sky-500' : 'h-[3px] rounded-full bg-sky-500'}`} />
      {meters !== undefined && (
        <span className="absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold tabular-nums text-neutral-400 dark:text-neutral-500">
          {formatDistance(meters)}
        </span>
      )}
    </span>
  );
}

function DiagramNode({ kind }: { kind: 'hydrant' | 'truck' | 'fire' }) {
  const look = {
    hydrant: { className: 'bg-sky-500', icon: <MdWaterDrop className="h-3 w-3" /> },
    truck: { className: 'bg-[#e0353b]', icon: <MdFireTruck className="h-3 w-3" /> },
    fire: { className: 'bg-orange-500', icon: <MdLocalFireDepartment className="h-3 w-3" /> },
  }[kind];
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-neutral-900 ${look.className}`}>
      {look.icon}
    </span>
  );
}

function Count({ label, value, detail, inset = false }: { label: string; value: number | undefined; detail: string[] | null | undefined; inset?: boolean }) {
  return (
    <div className={inset ? 'pl-3' : 'pr-3'}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</p>
      {value !== undefined ? (
        <>
          <p className="text-xl font-extrabold leading-tight tabular-nums text-neutral-800 dark:text-neutral-100">{value}</p>
          {detail && (
            // Wraps between items, never inside one.
            <p className="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
              {detail.map((item, i) => (
                <Fragment key={item}>
                  {i > 0 && ' · '}
                  <span className="whitespace-nowrap">{item}</span>
                </Fragment>
              ))}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-xl font-extrabold leading-tight text-neutral-300 dark:text-neutral-600">—</p>
          <span className="inline-block rounded-full bg-neutral-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            Pending data
          </span>
        </>
      )}
    </div>
  );
}

function Note({ tone, icon, children }: { tone: 'muted' | 'warn'; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className={`mt-2.5 flex items-start gap-1.5 text-[10px] leading-snug ${
      tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-400 dark:text-neutral-500'
    }`}>
      {icon ?? <FiInfo className="mt-px h-3 w-3 shrink-0" />}
      {children}
    </p>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{children}</p>;
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
