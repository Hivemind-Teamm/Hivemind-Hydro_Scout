// Pin for the place chosen in the map search bar. Purely visual: the map
// renders it with pointer events off so taps go through to the map.

export interface SearchPin {
  lat: number;
  lng: number;
  label: string;
}

export default function SearchPinMarker({ label }: { label: string }) {
  return (
    <div className="relative" style={{ width: 30, height: 40 }}>
      <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))' }}>
        <path d="M15 38.5S27.5 24.6 27.5 14a12.5 12.5 0 0 0-25 0C2.5 24.6 15 38.5 15 38.5Z" fill="#e0353b" stroke="#fff" strokeWidth="2" />
        <circle cx="15" cy="14" r="4.5" fill="#fff" />
      </svg>
      <span className="absolute left-[calc(100%+2px)] top-1.5 max-w-[11rem] truncate whitespace-nowrap rounded-md bg-white/95 px-2 py-0.5 text-xs font-bold text-neutral-800 shadow-md dark:bg-neutral-900/95 dark:text-neutral-100">
        {label}
      </span>
    </div>
  );
}
