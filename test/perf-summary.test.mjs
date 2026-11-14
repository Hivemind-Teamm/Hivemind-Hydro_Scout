import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CSV_COLUMNS, CSV_HEADER, csvLine, parseCsv } from '../scripts/perf-csv.mjs';
import { failedAttempts, stats, summarize } from '../scripts/perf-summary.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('stats: mean, sample SD (n - 1), median, min and max', () => {
  // Worked by hand: mean 5; squared deviations sum to 32; 32 / 7 = 4.571428...
  const result = stats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(result.n, 8);
  near(result.mean, 5);
  near(result.sd, Math.sqrt(32 / 7));
  near(result.median, 4.5);
  assert.equal(result.min, 2);
  assert.equal(result.max, 9);
});

test('stats: odd count takes the middle value and does not reorder the input', () => {
  const values = [30, 10, 20];
  const result = stats(values);
  assert.equal(result.median, 20);
  near(result.sd, 10);
  assert.deepEqual(values, [30, 10, 20]);
});

test('stats: one run has no SD, no runs has nothing', () => {
  assert.deepEqual(stats([1500]), { n: 1, mean: 1500, sd: null, median: 1500, min: 1500, max: 1500 });
  assert.deepEqual(stats([]), { n: 0, mean: null, sd: null, median: null, min: null, max: null });
});

test('a CSV row survives being written and read back', () => {
  const row = {
    measure: 'T1', run: 3, start: 'SP3', lat: 14.63648, lng: 121.0262, dest: 'HYD-012', route_m: 812,
    ms: 2690, status: 'ok', iso_time: '2026-11-14T02:03:04.005Z', t1a_ms: 1234, t1b_ms: 1456,
    phase: 'real', renderer: 'mapbox', on_route_hydrants: 4, note: 'covered pin, "sent" directly',
  };
  const { header, rows } = parseCsv(`${CSV_HEADER}\r\n${csvLine(row)}\r\n`);
  assert.deepEqual(header, CSV_COLUMNS);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], Object.fromEntries(CSV_COLUMNS.map(column => [column, String(row[column])])));
});

test('missing values are written as empty cells', () => {
  const line = csvLine({ measure: 'T2', run: 1, status: 'timeout' });
  assert.equal(line.split(',').length, CSV_COLUMNS.length);
  const { rows } = parseCsv(`${CSV_HEADER}\n${line}\n`);
  assert.equal(rows[0].ms, '');
  assert.equal(rows[0].status, 'timeout');
});

test('summary keeps every valid run, counts failures, and leaves trial rows out', () => {
  const row = (measure, status, ms, extra = {}) => ({ measure, status, ms: String(ms ?? ''), t1a_ms: '', t1b_ms: '', phase: 'real', ...extra });
  const rows = [
    row('T1', 'ok', 3000, { t1a_ms: '1000', t1b_ms: '2000' }),
    row('T1', 'timeout', undefined, { t1a_ms: '900' }),
    row('T1', 'ok', 9000, { t1a_ms: '4000', t1b_ms: '5000' }), // a slow run stays in
    row('T1', 'ok', 1, { t1a_ms: '1', t1b_ms: '0', phase: 'trial' }),
    row('T2', 'ok', 2000),
    row('T2', 'error'),
    row('T2', 'aborted'),
    row('T2', 'ok', 2500),
    row('T2', 'ok', 3000),
  ];
  const [t1, t1a, t1b, t2] = summarize(rows);
  assert.deepEqual([t1.measure, t1a.measure, t1b.measure, t2.measure], ['T1', 'T1a', 'T1b', 'T2']);

  assert.equal(t1.n, 2);
  assert.equal(t1.failed, 1);
  near(t1.mean, 6000);
  assert.equal(t1.max, 9000);
  // Parts come from valid T1 runs only: the timed-out run's 900 ms is not mixed in.
  near(t1a.mean, 2500);
  near(t1b.mean, 3500);
  assert.equal(t1a.failed, null);

  assert.equal(t2.n, 3);
  assert.equal(t2.failed, 2);
  near(t2.mean, 2500);
  near(t2.sd, 500);
  near(t2.median, 2500);

  const trial = summarize(rows, 'trial');
  assert.equal(trial[0].n, 1);
  assert.equal(trial[3].n, 0);
});

test('failed attempts are listed on their own and never reach the statistics', () => {
  const row = (measure, status, ms, extra = {}) => ({ measure, status, ms: String(ms ?? ''), t1a_ms: '', t1b_ms: '', phase: 'real', ...extra });
  const rows = [
    row('T2', 'ok', 1000),
    row('T2', 'aborted', 50, { note: 'isochrone: cache' }),  // has a time, still excluded
    row('T2', 'error', undefined, { note: 'did not settle' }),
    row('T2', 'timeout', undefined, { phase: 'trial' }),
  ];
  assert.deepEqual(failedAttempts(rows).map(r => r.note), ['isochrone: cache', 'did not settle']);
  assert.equal(failedAttempts(rows, 'trial').length, 1);
  const t2 = summarize(rows).at(-1);
  assert.equal(t2.n, 1);
  assert.equal(t2.failed, 2);
  near(t2.mean, 1000);
});
