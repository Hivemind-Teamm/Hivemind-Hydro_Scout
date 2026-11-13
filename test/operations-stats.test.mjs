import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  complianceStats, conditionTrend, statusBreakdown, statusFromRegister, zoneStats,
} from '../app/src/data/operations-stats.ts';
import { STATUS_ORDER, toOperationalStatus } from '../app/src/data/hydrants.ts';

const entry = (action, date, statusColor = '#000000') => ({ action, date, statusColor, by: 'Inspector', role: 'Head' });
const hydrant = (id, status, { barangay = 'Pinyahan', hazard = 'None', register } = {}) => ({
  id, status, barangay, hazard,
  register: register ?? [entry('Initial inspection', '2026-06-11')],
});

// 3 operational, 1 reduced, 1 out, 4 temporarily unavailable (BFP reference).
const sample = [
  hydrant('HYD-001', 'operational'),
  hydrant('HYD-002', 'operational', { barangay: 'Central' }),
  hydrant('HYD-003', 'operational', { hazard: 'Parked vehicles' }),
  hydrant('HYD-004', 'reduced', { barangay: 'Central' }),
  hydrant('HYD-005', 'out'),
  ...['BFP-001', 'BFP-002', 'BFP-003'].map(id => hydrant(id, 'reference', { barangay: 'Pinagkaisahan', hazard: 'Unverified', register: [entry('Initial inspection', '')] })),
  hydrant('BFP-004', 'reference', { hazard: 'Unverified', register: [entry('Initial inspection', '')] }),
];

test('status breakdown leaves temporarily unavailable hydrants out of the percentage', () => {
  assert.deepEqual(statusBreakdown(sample), { operational: 3, reduced: 1, out: 1, pending: 4, checked: 5, operationalPct: 60 });
  assert.equal(statusBreakdown(sample.filter(h => h.status === 'reference')).operationalPct, null);
});

test('hazard and compliance only count field-checked hydrants', () => {
  assert.deepEqual(complianceStats(sample), { verified: 5, obstructed: 1, compliant: 4, obstructedPct: 20 });
});

test('zones are barangays rated on checked hydrants; unchecked-only zones are pending', () => {
  const zones = Object.fromEntries(zoneStats(sample).map(z => [z.name, z]));
  assert.deepEqual(zones.Pinyahan, { name: 'Pinyahan', checked: 3, operational: 2, pending: 1, rating: 'moderate' });
  assert.deepEqual(zones.Central, { name: 'Central', checked: 2, operational: 1, pending: 0, rating: 'moderate' });
  assert.deepEqual(zones.Pinagkaisahan, { name: 'Pinagkaisahan', checked: 0, operational: 0, pending: 3, rating: 'pending' });
  assert.equal(zoneStats([hydrant('X', 'operational', { barangay: 'Unassigned' })])[0].name, 'No barangay');
});

test('only status-setting register entries define a status; report and validation colours do not', () => {
  for (const status of STATUS_ORDER) {
    const name = toOperationalStatus(status);
    assert.equal(statusFromRegister(entry(`Status set to ${name}`, '2026-11-01'), {}), status);
    assert.equal(statusFromRegister(entry(`Hydrant pinned as ${name}`, '2026-11-01'), {}), status);
  }
  assert.equal(statusFromRegister(entry('Initial inspection', '2026-06-11'), { status: 'reduced' }), 'reduced');
  for (const action of ['Record validated', 'Report resolved: Leak', 'Report denied', 'Flagged for re-inspection']) {
    assert.equal(statusFromRegister(entry(action, '2026-11-01', '#2fbf4f'), {}), null, action);
  }
});

test('the trend follows recorded status changes and ends on the live breakdown', () => {
  const now = new Date('2026-11-13T04:00:00Z');
  const history = [
    // Operational since June, never edited.
    hydrant('HYD-001', 'operational'),
    // Edited: operational on Oct 20, out of service on Nov 3.
    hydrant('HYD-002', 'out', { register: [entry('Status set to Operational', '2026-10-20T02:00:00Z'), entry('Status set to Out of Service', '2026-11-03')] }),
    // Pinned on Nov 10.
    hydrant('HYD-050', 'operational', { register: [entry('Hydrant pinned as Operational', '2026-11-10')] }),
    // BFP record checked and promoted on Nov 11; before that it was not checked.
    hydrant('BFP-007', 'reduced', { register: [entry('Status set to Reduced Pressure', '2026-11-11')] }),
    // Only a resolved report logged: the status never changed.
    hydrant('HYD-009', 'operational', { register: [entry('Report resolved: Leak', '2026-11-05', '#2fbf4f')] }),
    hydrant('BFP-001', 'reference', { register: [entry('Initial inspection', '')] }),
  ];
  const trend = conditionTrend(history, now, 5);
  assert.deepEqual(trend.map(p => p.day), ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13']);
  assert.deepEqual(trend.map(p => [p.checked, p.operationalPct]), [
    [2, 100], // HYD-001, HYD-009 (HYD-002 not edited yet)
    [3, 100], // + HYD-002 operational
    [3, 100],
    [3, 67],  // HYD-002 out of service
    [5, 60],  // live: 3 operational of 5 checked
  ]);
  assert.equal(conditionTrend([hydrant('BFP-001', 'reference', { register: [entry('Initial inspection', '')] })], now, 3)
    .every(p => p.operationalPct === null), true);
});
