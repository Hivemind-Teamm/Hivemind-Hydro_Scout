'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { STATUS_COLORS, type ReportStatus, type Report } from '../data/reports';
import { updateReportStatus } from '../data/store';

type Filter = 'all' | ReportStatus;

interface ReportsPanelProps {
  reports: Report[];
  loading: boolean;
  onViewUser: (name: string, role: string) => void;
}

export default function ReportsPanel({ reports, loading, onViewUser }: ReportsPanelProps) {
  const { role } = useAuth();
  const canResolve = role === 'head' || role === 'admin';
  const [filter, setFilter] = useState<Filter>('all');

  const counts = {
    all:      reports.length,
    pending:  reports.filter((r) => r.status === 'pending').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
    denied:   reports.filter((r) => r.status === 'denied').length,
  };

  const visible = filter === 'all' ? reports : reports.filter((r) => r.status === filter);

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all',      label: `All (${counts.all})`           },
    { key: 'pending',  label: `Pending (${counts.pending})`   },
    { key: 'resolved', label: `Resolved (${counts.resolved})` },
    { key: 'denied',   label: `Denied (${counts.denied})`     },
  ];

  return (
    <div className="anim-slide-left pointer-events-auto absolute bottom-6 left-[76px] top-[124px] z-[2100] flex w-[360px] flex-col overflow-hidden rounded-xl bg-white dark:bg-neutral-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <p className="text-sm font-extrabold uppercase tracking-wide text-neutral-800 dark:text-neutral-100">Reports Register</p>
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500">Service and status reports · QC Diliman, Quezon City</p>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors ${
              filter === tab.key
                ? 'border-b-2 border-[#FED42E] text-[#91191E] dark:text-[#e0353b]'
                : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Report list */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
        {visible.map((report) => (
          <ReportCard key={report.id} report={report} onViewUser={onViewUser} canResolve={canResolve} />
        ))}
        {loading && (
          <p className="px-4 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">Loading reports…</p>
        )}
        {!loading && visible.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">No reports found.</p>
        )}
      </div>
    </div>
  );
}

function ReportCard({ report, onViewUser, canResolve }: { report: Report; onViewUser: (name: string, role: string) => void; canResolve: boolean }) {
  const sc = STATUS_COLORS[report.status];
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleStatusChange(status: 'resolved' | 'denied') {
    setSaving(true);
    setErr(null);
    try {
      await updateReportStatus(report.hydrantId, report.firestoreId, status);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  }

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
      <p className="mb-1 text-xs font-semibold text-neutral-800 leading-snug dark:text-neutral-100">{report.title}</p>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{report.location}</p>
      <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
        <button
          onClick={() => onViewUser(report.reporter, report.role)}
          className="font-semibold text-[#91191E] hover:underline dark:text-[#e0353b]"
        >
          {report.reporter}
        </button>
        {' '}· {report.role} · {report.date} · {report.time}
      </p>

      {canResolve && report.status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => handleStatusChange('resolved')}
            disabled={saving}
            className="flex-1 rounded py-1 text-[10px] font-bold bg-[#e6f9ec] text-[#1e8a39] hover:bg-[#c6f0d1] disabled:opacity-50"
          >
            {saving ? '…' : 'Resolve'}
          </button>
          <button
            onClick={() => handleStatusChange('denied')}
            disabled={saving}
            className="flex-1 rounded py-1 text-[10px] font-bold bg-[#fce8e9] text-[#91191E] hover:bg-[#f9d0d2] disabled:opacity-50"
          >
            {saving ? '…' : 'Deny'}
          </button>
        </div>
      )}
      {err && <p className="mt-1 text-[10px] text-[#91191E] dark:text-[#e0353b]">{err}</p>}
    </div>
  );
}
