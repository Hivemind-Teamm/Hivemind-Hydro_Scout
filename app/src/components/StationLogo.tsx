/** Shared building logo for station pins and cluster notification badges. */
export default function StationLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16" fill="#dc2626" stroke="white" strokeWidth="2" />
      <path d="M9 15.5L18 9l9 6.5V26H9z" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 26v-7h10v7M15 18.5v-4h6v4" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 26v-3h4v3" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
