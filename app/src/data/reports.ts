export type ReportStatus = 'pending' | 'resolved' | 'denied';

export interface Report {
  id: string;
  hydrantId: string;
  title: string;
  location: string;
  reporter: string;
  role: string;
  date: string;
  time: string;
  status: ReportStatus;
}

export const STATUS_COLORS: Record<ReportStatus, { border: string; badge: string; text: string; label: string }> = {
  pending:  { border: '#f5a623', badge: '#fff4e0', text: '#c97a00', label: 'Pending'  },
  resolved: { border: '#2fbf4f', badge: '#e6f9ec', text: '#1e8a39', label: 'Resolved' },
  denied:   { border: '#91191E', badge: '#fce8e9', text: '#91191E', label: 'Denied'   },
};

export const REPORTS: Report[] = [
  {
    id: 'HYD-82-0647',
    hydrantId: 'H-01',
    title: 'No water — main valve stuck shut',
    location: "Yasmin's Village I",
    reporter: 'R. Cruz',
    role: 'Authorized User',
    date: '2025-04-19',
    time: '01:27',
    status: 'pending',
  },
  {
    id: 'HYD-82-0120',
    hydrantId: 'H-04',
    title: 'Obstructed by parked vehicle',
    location: 'Matalino St.',
    reporter: 'G. Santos',
    role: 'Authorized User',
    date: '2025-06-05',
    time: '06:40',
    status: 'pending',
  },
  {
    id: 'HYD-82-P75',
    hydrantId: 'H-08',
    title: 'Reduced pressure — below 37 PSI',
    location: 'S. Lino R5',
    reporter: 'N. Pacaos',
    role: 'Head',
    date: '2026-10-12',
    time: '16:45',
    status: 'resolved',
  },
  {
    id: 'HYD-82-984',
    hydrantId: 'H-03',
    title: 'Reported leak — tested | none found',
    location: 'Magaya St.',
    reporter: 'G. Dela Merced',
    role: 'Head',
    date: '2026-04-05',
    time: '12:12',
    status: 'denied',
  },
];
