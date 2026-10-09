import type { Hydrant, HydrantRegisterEntry } from './hydrants';
import type { Report, ReportStatus } from './reports';

export type RegisterFilter = 'all' | 'updates' | ReportStatus;
export type ReportsRegisterItem =
  | { kind: 'report'; key: string; date: string; report: Report }
  | { kind: 'update'; key: string; date: string; hydrantId: string; location: string; entry: HydrantRegisterEntry };

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Reverse first so later appended entries win when legacy dates have no time.
export function registerEntriesNewestFirst(entries: HydrantRegisterEntry[]): HydrantRegisterEntry[] {
  return [...entries].reverse().sort((a, b) => dateValue(b.date) - dateValue(a.date));
}

export function reportsRegisterItems(reports: Report[], hydrants: Hydrant[]): ReportsRegisterItem[] {
  const items: ReportsRegisterItem[] = reports.map(report => ({
    kind: 'report', key: `report:${report.hydrantId}:${report.firestoreId}`,
    date: report.createdAt || `${report.date}T${report.time || '00:00'}:00`, report,
  }));
  for (const hydrant of hydrants) {
    hydrant.register.forEach((entry, index) => {
      // Damage report outcomes already have their own report cards.
      if (!/^Status (set to\b|update\b)/i.test(entry.action)) return;
      items.push({
        kind: 'update', key: `update:${hydrant.id}:${index}`, date: entry.date,
        hydrantId: hydrant.id, location: `${hydrant.name} · ${hydrant.area}`, entry,
      });
    });
  }
  return items.reverse().sort((a, b) => dateValue(b.date) - dateValue(a.date));
}

export function filterRegisterItems(items: ReportsRegisterItem[], filter: RegisterFilter): ReportsRegisterItem[] {
  return items.filter(item => filter === 'all' || (filter === 'updates'
    ? item.kind === 'update'
    : item.kind === 'report' && item.report.status === filter));
}

export function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(value.includes('T') ? { hour: 'numeric', minute: '2-digit', second: '2-digit' } : {}),
  });
}