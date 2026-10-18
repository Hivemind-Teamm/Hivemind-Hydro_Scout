import { MdFireTruck } from 'react-icons/md';
import type { SupplyTruck } from '@/lib/supply-layout';

const TITLES: Record<SupplyTruck['role'], string> = {
  pumper: 'Pumper at the hydrant',
  relay: 'Relay pumper',
  engine: 'Engine at the fire',
};

/** A fire truck on the supply line, shared by both map providers. */
export default function FireTruckBadge({ role, count }: Pick<SupplyTruck, 'role' | 'count'>) {
  const label = count > 1 ? `${TITLES[role]} and ${count - 1} relay ${count > 2 ? 'pumpers' : 'pumper'}` : TITLES[role];
  return (
    <div className={`fire-truck fire-truck-${role}`} role="img" aria-label={label}>
      <MdFireTruck />
      {count > 1 && <span className="fire-truck-count">{count}</span>}
    </div>
  );
}
