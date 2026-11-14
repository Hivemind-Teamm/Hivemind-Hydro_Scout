// CSV layout of results/t1_t2_runs.csv, shared by perf-runs.mjs (writes it)
// and perf-summary.mjs (reads it).

export const CSV_COLUMNS = [
  'measure',            // T1 or T2
  'run',                // 1..30; a redo keeps the number of the run it repeats
  'start',              // start point label, SP1..SP6
  'lat',
  'lng',
  'dest',               // id of the hydrant searched and routed to
  'route_m',            // route length the app shows, in metres
  'ms',                 // T1 = t1a_ms + t1b_ms; T2 = Route click to settled map
  'status',             // ok | error | timeout | aborted
  'iso_time',
  't1a_ms',             // T1 only: Find Nearest Hydrant click to settled map
  't1b_ms',             // T1 only: Route click to settled map
  'phase',              // trial | real
  'renderer',           // mapbox | maplibre
  'on_route_hydrants',  // hydrants shown along the route
  'note',
];

function cell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line (no line break) for a row object keyed by column name. */
export function csvLine(row) {
  return CSV_COLUMNS.map(column => cell(row[column])).join(',');
}

export const CSV_HEADER = CSV_COLUMNS.join(',');

/** Parse CSV text into row objects keyed by the header line. Every value stays a string. */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(value); value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(value); value = '';
      if (record.some(item => item !== '')) records.push(record);
      record = [];
    } else {
      value += char;
    }
  }
  record.push(value);
  if (record.some(item => item !== '')) records.push(record);

  const [header, ...lines] = records;
  if (!header) return { header: [], rows: [] };
  return {
    header,
    rows: lines.map(line => Object.fromEntries(header.map((name, index) => [name, line[index] ?? '']))),
  };
}
