import { MdFireTruck } from 'react-icons/md';
import { TRUCK_ROLE_LABELS, type SupplyTruck } from '@/lib/supply-layout';

/** A fire truck on the supply line, shared by both map providers. */
export default function FireTruckBadge({ role, count }: Pick<SupplyTruck, 'role' | 'count'>) {
  const title = TRUCK_ROLE_LABELS[role];
  const label = count > 1 ? `${title} and ${count - 1} relay ${count > 2 ? 'engines' : 'engine'}` : title;
  return (
    <div className={`fire-truck fire-truck-${role}`} role="img" aria-label={label} title={label}>
      <MdFireTruck />
      {count > 1 && <span className="fire-truck-count">{count}</span>}
    </div>
  );
}
