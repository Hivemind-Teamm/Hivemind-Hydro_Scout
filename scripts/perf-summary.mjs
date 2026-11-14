#!/usr/bin/env node
// Summary of the thesis timing runs in results/t1_t2_runs.csv.
//
//   node scripts/perf-summary.mjs            real runs
//   node scripts/perf-summary.mjs --trial    trial runs
//   node scripts/perf-summary.mjs --file <path-to-csv>
//
// For each measure: n (valid runs), number of failed runs, mean, SD (sample,
// n - 1), median, min and max, all in ms. Every valid run is included; no
// outlier is excluded and nothing in the CSV is changed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from './perf-csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CSV = path.join(ROOT, 'results', 't1_t2_runs.csv');

/** n, mean, sample SD (n - 1), median, min, max. SD is null when n < 2. */
export function stats(values) {
  const n = values.length;
  if (n === 0) return { n, mean: null, sd: null, median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const sd = n < 2 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
  const middle = Math.floor(n / 2);
  const median = n % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { n, mean, sd, median, min: sorted[0], max: sorted[n - 1] };
}

function numbers(rows, column) {
  return rows.map(row => row[column]).filter(text => text !== '').map(Number).filter(Number.isFinite);
}

/** Summary lines for one phase ('real' or 'trial'). T1a and T1b are the two parts of T1. */
export function summarize(rows, phase = 'real') {
  const inPhase = rows.filter(row => row.phase === phase);
  const lines = [];
  for (const measure of ['T1', 'T2']) {
    const all = inPhase.filter(row => row.measure === measure);
    const valid = all.filter(row => row.status === 'ok');
    lines.push({ measure, failed: all.length - valid.length, ...stats(numbers(valid, 'ms')) });
    if (measure === 'T1') {
      lines.push({ measure: 'T1a', failed: null, ...stats(numbers(valid, 't1a_ms')) });
      lines.push({ measure: 'T1b', failed: null, ...stats(numbers(valid, 't1b_ms')) });
    }
  }
  return lines;
}

function format(value, decimals) {
  return value === null ? 'n/a' : value.toFixed(decimals);
}

function main() {
  const args = process.argv.slice(2);
  const phase = args.includes('--trial') ? 'trial' : 'real';
  const fileFlag = args.indexOf('--file');
  const file = fileFlag >= 0 && args[fileFlag + 1] ? path.resolve(args[fileFlag + 1]) : DEFAULT_CSV;
  if (!fs.existsSync(file)) {
    console.error(`No runs file at ${file}. Run scripts/perf-runs.mjs first.`);
    process.exit(1);
  }
  const { rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  const lines = summarize(rows, phase);

  const shown = path.relative(ROOT, file);
  console.log(`Hydro-Scout timing summary: ${phase} runs from ${shown.startsWith('..') ? file : shown}`);
  console.log('Times in ms. Every valid run is included; no outliers are excluded. SD is the sample SD (n - 1).');
  console.log('T1 = T1a + T1b (T1a: search click to map idle; T1b: Route click to map idle).');
  console.log('');
  const table = [
    ['measure', 'n', 'failed', 'mean', 'sd', 'median', 'min', 'max'],
    ...lines.map(line => [
      line.measure.length > 2 ? `  ${line.measure}` : line.measure,
      String(line.n),
      line.failed === null ? '-' : String(line.failed),
      format(line.mean, 2),
      format(line.sd, 2),
      format(line.median, 1),
      format(line.min, 0),
      format(line.max, 0),
    ]),
  ];
  const widths = table[0].map((_, column) => Math.max(...table.map(row => row[column].length)));
  for (const row of table) {
    console.log(row.map((text, column) => (column === 0 ? text.padEnd(widths[column]) : text.padStart(widths[column]))).join('  '));
  }
  if (!lines.some(line => line.n > 0)) console.log(`\nNo valid ${phase} runs in the file yet.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
