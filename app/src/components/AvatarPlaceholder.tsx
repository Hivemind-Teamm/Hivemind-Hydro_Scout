// Standard profile-picture placeholder — a person silhouette shown wherever a
// real avatar image isn't available. Replaces the old initials-based fallbacks
// so every empty avatar reads as one consistent "no photo" placeholder.
// Inherits its color from the parent (currentColor); parent controls the circle.
export default function AvatarPlaceholder({ className = 'h-[70%] w-[70%]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}
