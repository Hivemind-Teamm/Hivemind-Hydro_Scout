import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportsRegisterItems, filterRegisterItems, registerEntriesNewestFirst, formatHistoryDate } from '../app/src/data/hydrant-history.ts';
import { reportFromDoc } from '../app/src/data/reports.ts';

const entry = (action, date, by = 'Inspector') => ({ action, date, by, role: 'Head', statusColor: '#2fbf4f' });
const hydrant = (id, register) => ({ id, name: `Hydrant ${id}`, area: 'Diliman', register });
const report = (overrides = {}) => ({ id: 'RPT-1', firestoreId: 'r1', hydrantId: 'HYD-1', title: 'Leak', reporter: 'Inspector', role: 'Head', location: 'Diliman', date: '2026-10-09', time: '09:30', status: 'pending', createdAt: '2026-10-09T01:30:00Z', ...overrides });

test('a saved status update appears beside damage reports with its hydrant and author', () => {
  const items = reportsRegisterItems([report()], [hydrant('HYD-1', [
    entry('Initial inspection', '2026-10-01'),
    entry('Status set to Operational', '2026-10-09T02:00:00Z', 'New Inspector'),
  ])]);
  assert.deepEqual(items.map(item => item.kind), ['update', 'report']);
  assert.equal(items[0].hydrantId, 'HYD-1');
  assert.equal(items[0].entry.by, 'New Inspector');
  assert.equal(items[0].entry.action, 'Status set to Operational');
  assert.equal(items[0].location, 'Hydrant HYD-1 · Diliman');
});

test('status filters preserve damage report counts and keep updates out of pending work', () => {
  const reports = [report(), report({ firestoreId: 'r2', status: 'resolved' }), report({ firestoreId: 'r3', status: 'denied' })];
  const items = reportsRegisterItems(reports, [hydrant('HYD-1', [entry('Status set to Reduced Pressure', '2026-10-09')])]);
  assert.equal(filterRegisterItems(items, 'all').length, 4);
  for (const filter of ['updates', 'pending', 'resolved', 'denied']) {
    assert.equal(filterRegisterItems(items, filter).length, 1);
  }
  assert.equal(filterRegisterItems(items, 'updates')[0].kind, 'update');
  assert.equal(filterRegisterItems(items, 'pending')[0].kind, 'report');
});

test('report outcomes are not duplicated as updates and report keys include the hydrant', () => {
  const items = reportsRegisterItems([report(), report({ hydrantId: 'HYD-2' })], [hydrant('HYD-1', [
    entry('Report resolved: Leak', '2026-10-09'), entry('Report denied: Leak', '2026-10-09'),
  ])]);
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map(item => item.key)).size, 2);
});

test('the log sorts edits newest first, preserves repeated same-day edits, and does not mutate history', () => {
  const history = [
    entry('Status set to Operational', '2026-10-09T02:00:00Z'),
    entry('Status set to Out of Service', '2026-10-09T03:00:00Z'),
    entry('Status set to Operational', '2026-10-09T04:00:00Z'),
  ];
  const original = [...history];
  assert.deepEqual(registerEntriesNewestFirst(history), [history[2], history[1], history[0]]);
  assert.deepEqual(history, original);
  assert.equal(reportsRegisterItems([], [hydrant('HYD-1', history)]).length, 3);
  const legacy = [entry('First', '2026-10-08'), entry('Second', '2026-10-08'), entry('Undated', '')];
  assert.deepEqual(registerEntriesNewestFirst(legacy).map(e => e.action), ['Second', 'First', 'Undated']);
});

test('exact report timestamps determine ordering even when the display time is local', () => {
  const mapped = reportFromDoc('r1', 'HYD-1', { createdAt: { toDate: () => new Date('2026-10-09T01:00:00Z') } });
  assert.equal(mapped.createdAt, '2026-10-09T01:00:00.000Z');
  const items = reportsRegisterItems([mapped], [hydrant('HYD-1', [entry('Status update', '2026-10-09T01:01:00Z')])]);
  assert.equal(items[0].kind, 'update');
  assert.equal(formatHistoryDate('invalid date'), 'invalid date');
  assert.equal(formatHistoryDate(''), '—');
  assert.match(formatHistoryDate('2026-10-09T01:01:00Z'), /2026/);
});