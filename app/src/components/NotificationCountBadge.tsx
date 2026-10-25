export default function NotificationCountBadge({ count, label, className = '' }: {
  count: number; label: string; className?: string;
}) {
  if (count <= 0) return null;
  return <span role="img" aria-label={`${count} ${label}`}
    className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#e0353b] px-1 text-[10px] font-bold leading-none tabular-nums text-white ${className}`}>
    {count > 99 ? '99+' : count}
  </span>;
}
