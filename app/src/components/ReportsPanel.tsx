'use client';

import { useState } from 'react';
import { REPORTS, STATUS_COLORS, type ReportStatus, type Report } from '../data/reports';

type Filter = 'all' | ReportStatus;

export default function ReportsPanel({ onViewUser }: { onViewUser: (name: string, role: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');

  const counts = {
    all:      REPORTS.length,
    pending:  REPORTS.filter((r) => r.status === 'pending').length,
    resolved: REPORTS.filter((r) => r.status === 'resolved').length,
    denied:   REPORTS.filter((r) => r.status === 'denied').length,
  };

  const visible = filter === 'all' ? REPORTS : REPORTS.filter((r) => r.status === filter);

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all',      label: `All (${counts.all})`           },
    { key: 'pending',  label: `Pending (${counts.pending})`   },
    { key: 'resolved', label: `Resolved (${counts.resolved})` },
    { key: 'denied',   label: `Denied (${counts.denied})`     },
  ];

  return (
    <div className="pointer-events-auto absolute bottom-0 left-[72px] top-[69px] z-[1500] flex w-[360px] flex-col bg-white shadow-2xl">
      {/* Header */}
      <div className="border-b border-neutral-200 px-4 py-3">
        <p className="text-sm font-extrabold uppercase tracking-wide text-neutral-800">Reports Register</p>
        <p className="text-[10px] text-neutral-400">Service and status reports · QC Diliman, Quezon City</p>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-neutral-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors ${
              filter === tab.key
                ? 'border-b-2 border-[#FED42E] text-[#91191E]'
                : 'text-neutral-400 hover:text-neutral-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Report list */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
        {visible.map((report) => (
          <ReportCard key={report.id} report={report} onViewUser={onViewUser} />
        ))}
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-neutral-400">No reports found.</p>
        )}
      </div>
    </div>
  );
}

function ReportCard({ report, onViewUser }: { report: Report; onViewUser: (name: string, role: string) => void }) {
  const sc = STATUS_COLORS[report.status];

  return (
    <div
      className="px-4 py-3"
      style={{ borderLeft: `3px solid ${sc.border}` }}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold text-[#91191E]">{report.id}</span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: sc.badge, color: sc.text }}
        >
          {sc.label}
        </span>
      </div>
      <p className="mb-1 text-xs font-semibold text-neutral-800 leading-snug">{report.title}</p>
      <p className="text-[11px] text-neutral-500">{report.location}</p>
      <p className="mt-1 text-[10px] text-neutral-400">
        <button
          onClick={() => onViewUser(report.reporter, report.role)}
          className="font-semibold text-[#91191E] hover:underline"
        >
          {report.reporter}
        </button>
        {' '}· {report.role} · {report.date} · {report.time}
      </p>
    </div>
  );
}
