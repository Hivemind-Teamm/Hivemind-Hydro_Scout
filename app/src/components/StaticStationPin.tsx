'use client';

interface StaticStationPinProps {
  name: string;
}

export default function StaticStationPin({ name }: StaticStationPinProps) {
  return (
    <div
      title={name}
      aria-label={`Fire station: ${name}`}
      className="flex flex-col items-center"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-red-700 text-white shadow-lg">
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 21h18" />
          <path d="M5 21V9l7-5 7 5v12" />
          <path d="M9 21v-7h6v7" />
          <path d="M9 10h.01M15 10h.01" />
        </svg>
      </div>
      <div className="h-2 w-0.5 bg-red-700" />
      <div className="h-1.5 w-1.5 rounded-full bg-red-700" />
    </div>
  );
}
