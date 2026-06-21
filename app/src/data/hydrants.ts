// Mock hydrant dataset for the Hydro-Scout dashboard spike.

export type HydrantStatus   = 'operational' | 'reduced' | 'out';
export type HydrantPressure = 'Strong' | 'Moderate' | 'Low' | 'None';
export type HydrantKey      = 'Required' | 'None';

export interface HydrantNote {
  user: string;
  initials: string;
  text: string;
  date: string;
}

export interface HydrantRegisterEntry {
  statusColor: string;
  action: string;
  by: string;
  role: string;
  date: string;
}

export interface Hydrant {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: HydrantStatus;
  pressure: HydrantPressure;
  key: HydrantKey;
  // Details
  type: string;
  mounting: string;
  keyWrench: string;
  area: string;
  outlets: number;
  color: string;
  concessionaire: string;
  landmark: string;
  hazard: string;
  distanceM: number;
  distanceMin: number;
  notes: HydrantNote[];
  register: HydrantRegisterEntry[];
}

export interface StatusMeta {
  color: string;
  iconUrl: string;
  legendLabel: string;
  pillLabel: string;
}

export const STATUS_META: Record<HydrantStatus, StatusMeta> = {
  operational: {
    color: '#2fbf4f',
    iconUrl: '/Hydrant%20Pin%20Gren.png',
    legendLabel: 'Operational',
    pillLabel: 'Operational',
  },
  reduced: {
    color: '#f5a623',
    iconUrl: '/Hydrant%20Pin%20Orange.png',
    legendLabel: 'Reduced Pressure',
    pillLabel: 'Low Pressure',
  },
  out: {
    color: '#9aa0a6',
    iconUrl: '/Hydrant%20Pin%20Gray.png',
    legendLabel: 'Out of Service',
    pillLabel: 'Out of Service',
  },
};

export const STATUS_ORDER: HydrantStatus[] = ['operational', 'reduced', 'out'];

export const HYDRANTS: Hydrant[] = [
  {
    id: 'H-01', name: 'Scout Borromeo St.', lat: 14.6555, lng: 121.0700,
    status: 'operational', pressure: 'Strong', key: 'None',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Scout Area', outlets: 2, color: 'Yellow', concessionaire: 'Manila Water',
    landmark: 'Near Jollibee Scout Borromeo', hazard: 'None', distanceM: 240, distanceMin: 1,
    notes: [
      { user: 'M.G. Torres', initials: 'MT', text: 'Clear access from the avenue side. Cap occasionally parked-in on weekends — approach from Maginhawa if blocked.', date: '2026-06-12' },
      { user: 'J. Tan', initials: 'JT', text: 'Skibidi toilet.', date: '2026-05-11' },
    ],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'M.G. Torres', role: 'Authorized', date: '2026-06-12 / 08:16' },
      { statusColor: '#f5a623', action: 'Reduced pressure → Forwarded to Manila Water', by: 'A. Morse-Cabalyaran', role: 'Head', date: '2026-05-28 / 17:22' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-11 / 13:07' },
    ],
  },
  {
    id: 'H-02', name: 'Tomas Morato Ave.', lat: 14.6520, lng: 121.0660,
    status: 'operational', pressure: 'Strong', key: 'None',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Scout Area', outlets: 2, color: 'Red', concessionaire: 'Manila Water',
    landmark: 'In front of Morato Church', hazard: 'None', distanceM: 380, distanceMin: 2,
    notes: [],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'M.G. Torres', role: 'Authorized', date: '2026-06-10 / 09:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-11 / 14:00' },
    ],
  },
  {
    id: 'H-03', name: 'Pansy Ave.', lat: 14.6500, lng: 121.0690,
    status: 'operational', pressure: 'Moderate', key: 'None',
    type: 'Pillar', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Heroes Hill', outlets: 1, color: 'Yellow', concessionaire: 'Manila Water',
    landmark: 'Corner Quezon Ave.', hazard: 'None', distanceM: 500, distanceMin: 3,
    notes: [],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'A. Reyes', role: 'Authorized', date: '2026-06-08 / 10:30' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-12 / 09:00' },
    ],
  },
  {
    id: 'H-04', name: 'Kamuning Rd.', lat: 14.6540, lng: 121.0722,
    status: 'operational', pressure: 'Strong', key: 'Required',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Triangular',
    area: 'East Triangle', outlets: 2, color: 'Red', concessionaire: 'Manila Water',
    landmark: 'Near Kamuning MRT Station', hazard: 'None', distanceM: 620, distanceMin: 4,
    notes: [
      { user: 'A. Reyes', initials: 'AR', text: 'Key required — contact barangay hall for access.', date: '2026-06-01' },
    ],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'A. Reyes', role: 'Authorized', date: '2026-06-01 / 11:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-13 / 08:00' },
    ],
  },
  {
    id: 'H-05', name: 'Kalayaan Ave.', lat: 14.6490, lng: 121.0650,
    status: 'operational', pressure: 'Moderate', key: 'None',
    type: 'Pillar', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Heroes Hill', outlets: 1, color: 'Yellow', concessionaire: 'MWSS',
    landmark: 'Near Kalayaan Park', hazard: 'None', distanceM: 750, distanceMin: 5,
    notes: [],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'M.G. Torres', role: 'Authorized', date: '2026-06-05 / 14:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-14 / 10:00' },
    ],
  },
  {
    id: 'H-06', name: 'Times St.', lat: 14.6562, lng: 121.0665,
    status: 'operational', pressure: 'Strong', key: 'None',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Nayong Kanluran', outlets: 2, color: 'Red', concessionaire: 'Manila Water',
    landmark: 'Corner Tomas Morato', hazard: 'None', distanceM: 290, distanceMin: 2,
    notes: [],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'A. Reyes', role: 'Authorized', date: '2026-06-09 / 09:30' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-15 / 08:30' },
    ],
  },
  {
    id: 'H-07', name: 'Scout Rallos St.', lat: 14.6512, lng: 121.0712,
    status: 'operational', pressure: 'Moderate', key: 'Required',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Triangular',
    area: 'Scout Area', outlets: 2, color: 'Yellow', concessionaire: 'Manila Water',
    landmark: 'Near Scout Rallos Elem.', hazard: 'None', distanceM: 460, distanceMin: 3,
    notes: [],
    register: [
      { statusColor: '#2fbf4f', action: 'Confirmed operational', by: 'M.G. Torres', role: 'Authorized', date: '2026-06-07 / 15:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-16 / 09:00' },
    ],
  },
  {
    id: 'H-08', name: 'Scout Madriñan St.', lat: 14.6535, lng: 121.0682,
    status: 'reduced', pressure: 'Low', key: 'None',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Scout Area', outlets: 1, color: 'Yellow', concessionaire: 'Manila Water',
    landmark: 'Corner Timog Ave.', hazard: 'None', distanceM: 340, distanceMin: 2,
    notes: [
      { user: 'A. Morse-Cabalyaran', initials: 'AM', text: 'Pressure drop reported since May. Forwarded to Manila Water for inspection.', date: '2026-05-28' },
    ],
    register: [
      { statusColor: '#f5a623', action: 'Reduced pressure — forwarded to Manila Water', by: 'A. Morse-Cabalyaran', role: 'Head', date: '2026-05-28 / 17:22' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-11 / 15:00' },
    ],
  },
  {
    id: 'H-09', name: 'Scout Castor St.', lat: 14.6480, lng: 121.0702,
    status: 'reduced', pressure: 'Low', key: 'Required',
    type: 'Pillar', mounting: 'above ground', keyWrench: 'Triangular',
    area: 'Scout Area', outlets: 1, color: 'Red', concessionaire: 'MWSS',
    landmark: 'Near Don A. Roces Ave.', hazard: 'None', distanceM: 810, distanceMin: 5,
    notes: [],
    register: [
      { statusColor: '#f5a623', action: 'Reduced pressure noted', by: 'A. Reyes', role: 'Authorized', date: '2026-06-01 / 08:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-17 / 10:00' },
    ],
  },
  {
    id: 'H-10', name: 'Mother Ignacia Ave.', lat: 14.6556, lng: 121.0642,
    status: 'reduced', pressure: 'Low', key: 'None',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Standard pentagon',
    area: 'Nayong Kanluran', outlets: 2, color: 'Yellow', concessionaire: 'Manila Water',
    landmark: 'Near Mother Ignacia Parish', hazard: 'None', distanceM: 430, distanceMin: 3,
    notes: [],
    register: [
      { statusColor: '#f5a623', action: 'Reduced pressure — monitoring', by: 'M.G. Torres', role: 'Authorized', date: '2026-06-03 / 11:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-18 / 09:30' },
    ],
  },
  {
    id: 'H-11', name: 'Scout Lozano St.', lat: 14.6505, lng: 121.0635,
    status: 'out', pressure: 'None', key: 'Required',
    type: 'Barrel', mounting: 'above ground', keyWrench: 'Triangular',
    area: 'Scout Area', outlets: 1, color: 'Gray', concessionaire: 'Manila Water',
    landmark: 'Corner Scout De Guia St.', hazard: 'Damaged cap', distanceM: 920, distanceMin: 6,
    notes: [
      { user: 'A. Morse-Cabalyaran', initials: 'AM', text: 'Cap damaged — out of service pending replacement parts. Do not use.', date: '2026-06-10' },
    ],
    register: [
      { statusColor: '#9aa0a6', action: 'Marked out of service — damaged cap', by: 'A. Morse-Cabalyaran', role: 'Head', date: '2026-06-10 / 08:00' },
      { statusColor: '#f5a623', action: 'Reduced pressure flagged', by: 'A. Reyes', role: 'Authorized', date: '2026-06-01 / 09:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-19 / 11:00' },
    ],
  },
  {
    id: 'H-12', name: 'Don A. Roces Ave.', lat: 14.6472, lng: 121.0676,
    status: 'out', pressure: 'None', key: 'None',
    type: 'Pillar', mounting: 'below ground', keyWrench: 'Standard pentagon',
    area: 'Scout Area', outlets: 1, color: 'Gray', concessionaire: 'MWSS',
    landmark: 'Near SM North EDSA access road', hazard: 'Road obstruction', distanceM: 1050, distanceMin: 7,
    notes: [
      { user: 'M.G. Torres', initials: 'MT', text: 'Road crew has blocked access. Reported to barangay.', date: '2026-06-08' },
    ],
    register: [
      { statusColor: '#9aa0a6', action: 'Marked out of service — road obstruction', by: 'M.G. Torres', role: 'Authorized', date: '2026-06-08 / 13:00' },
      { statusColor: '#9aa0a6', action: 'Initial registration', by: 'J. Tan', role: 'Authorized', date: '2026-05-20 / 14:00' },
    ],
  },
];

export function countByStatus(hydrants: Hydrant[]): Record<HydrantStatus, number> {
  return hydrants.reduce(
    (acc, h) => { acc[h.status] += 1; return acc; },
    { operational: 0, reduced: 0, out: 0 } as Record<HydrantStatus, number>,
  );
}
