// Shared pill badge: a colored status dot + uppercase, letter-spaced label on a
// thin tinted-border chip with fully rounded sides. Used for both user-role tags
// (admin directory) and report-status tags (Reports register / hydrant log) so
// they read as one consistent, professional label style rather than filled
// pastel pills.

export default function PillBadge({ dot, color, label }: { dot: string; color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]"
      style={{ borderColor: `${dot}33`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}
