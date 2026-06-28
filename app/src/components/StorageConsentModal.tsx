'use client';

interface StorageConsentModalProps {
  onAllow: () => void;
  onDecline: () => void;
}

export default function StorageConsentModal({ onAllow, onDecline }: StorageConsentModalProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 [backdrop-filter:blur(4px)]">
      <div className="anim-fade-scale w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-neutral-900">

        {/* Icon header */}
        <div className="flex flex-col items-center gap-3 rounded-t-2xl bg-neutral-50 px-6 py-6 dark:bg-neutral-800">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FED42E]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <p className="text-center text-sm font-extrabold text-neutral-800 dark:text-neutral-100">
            Storage Access Permission
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Hydro-Scout would like to access files on your device.
          </p>
          <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            This allows you to select photos from your personal storage to upload as your display photo or as hydrant field photos. Your files are only uploaded when you confirm, and are stored securely.
          </p>

          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            This permission will be remembered for future uploads.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onDecline}
            className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-600 transition-all duration-150 ease-out hover:scale-[1.02] hover:bg-neutral-50 active:scale-[0.97] active:duration-75 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Decline
          </button>
          <button
            onClick={onAllow}
            className="flex-1 rounded-xl bg-[#e0353b] py-2.5 text-sm font-bold text-white transition-all duration-150 ease-out hover:scale-[1.02] hover:bg-[#c42d32] hover:shadow-[0_4px_12px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
