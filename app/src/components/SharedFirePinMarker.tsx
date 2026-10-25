import { FLAME_PATH } from './fireIcon';
import { useEffect, useState } from 'react';
import { FIRE_ARRIVAL_DURATION_MS } from '@/lib/fire-pin-arrivals';

function ArrivalPulse({ at }: { at: number }) {
  const [visible, setVisible] = useState(() => Date.now() - at < FIRE_ARRIVAL_DURATION_MS);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), Math.max(0, at + FIRE_ARRIVAL_DURATION_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [at]);
  return visible ? <><span className="fire-pin-arrival" /><span className="fire-pin-arrival fire-pin-arrival-second" /></> : null;
}

export default function SharedFirePinMarker({ onSelect, arrivalAt }: { onSelect: () => void; arrivalAt?: number }) {
  return <button type="button" className="fire-pin" aria-label="View shared fire incident" onClick={event => { event.stopPropagation(); onSelect(); }}>
    <span className="fire-pin-pulse" /><span className="fire-pin-pulse fire-pin-pulse-late" />
    {arrivalAt !== undefined && <ArrivalPulse key={arrivalAt} at={arrivalAt} />}
    <span className="fire-pin-core"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={FLAME_PATH} /></svg></span>
  </button>;
}
