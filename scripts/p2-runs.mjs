#!/usr/bin/env node
// P2 initial map-load trials. Uses the signed-in Chrome profile shared with
// perf-runs.mjs, clears only the HTTP cache before every navigation, and waits
// for the app's `hs-markers-interactive` P2 record.
//
//   node scripts/p2-runs.mjs --login
//   node scripts/p2-runs.mjs --trial
//   node scripts/p2-runs.mjs

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_DIR = path.join(ROOT, '.perf-profile');
const RESULTS_DIR = path.join(ROOT, 'results');
const CSV_PATH = path.join(RESULTS_DIR, 'p2_trials.csv');
const META_PATH = path.join(RESULTS_DIR, 'run_meta.json');
const VIEWPORT = { width: 1366, height: 768 };
const TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 60_000;
const PAUSE_MS = 5_000;
const VALID_TARGET = 30;
const TRIAL_TARGET = 2;
const MAX_INVALID = 10;
const HEADER = 'class,trial,status,p2_ms,cache_mode,hydrants_drawn,view,network,note,iso_time';

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error('Usage: node scripts/p2-runs.mjs [--login | --trial] [--url <address>] [--network <text>] [--target <text>] [--allow-dirty]');
  process.exit(problem ? 1 : 0);
}

function args(argv) {
  const options = {
    login: false,
    trial: false,
    allowDirty: false,
    url: process.env.APP_URL ?? 'http://localhost:3000/dashboard',
    network: 'TO BE ENTERED BY HAND',
    target: 'TO BE ENTERED BY HAND',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      if (argv[index] === undefined) usage(`${arg} needs a value.`);
      return argv[index];
    };
    if (arg === '--login') options.login = true;
    else if (arg === '--trial') options.trial = true;
    else if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--url') options.url = value();
    else if (arg === '--network') options.network = value();
    else if (arg === '--target') options.target = value();
    else if (arg === '--help' || arg === '-h') usage();
    else usage(`Unknown option: ${arg}`);
  }
  if (options.login && options.trial) usage('Use --login and --trial separately.');
  return options;
}

function launch() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: VIEWPORT,
  });
}

function git(...gitArgs) {
  try { return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; }
}

function append(row) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, `${HEADER}\n`);
  const values = HEADER.split(',').map(key => String(row[key] ?? '').replaceAll('"', '""'));
  fs.appendFileSync(CSV_PATH, `${values.map(value => `"${value}"`).join(',')}\n`);
}

function validRows(phase) {
  if (!fs.existsSync(CSV_PATH)) return 0;
  return fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).slice(1).filter(line =>
    line.includes(`"${phase}"`),
  ).length;
}

function saveMeta(session) {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { /* new results folder */ }
  const sessions = Array.isArray(meta.p2Sessions) ? meta.p2Sessions : [];
  const existing = sessions.findIndex(item => item.id === session.id);
  if (existing >= 0) sessions[existing] = session;
  else sessions.push(session);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(META_PATH, `${JSON.stringify({ ...meta, p2Sessions: sessions }, null, 2)}\n`);
}

async function login(options) {
  const context = await launch();
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(new URL('/login', options.url).href, { timeout: LOAD_TIMEOUT_MS });
  console.log('Sign in by hand with the test-project station account, wait for the dashboard, then press Enter.');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question('Press Enter to save the session and close Chrome. ');
  prompt.close();
  const signedIn = !page.isClosed() && new URL(page.url()).pathname.startsWith('/dashboard');
  await context.close();
  if (!signedIn) throw new Error('The dashboard was not open, so the sign-in session was not saved.');
}

async function p2Mark(page, marksFrom) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = marksFrom.marks.slice(marksFrom.index).find(mark => mark.measure === 'P2');
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

async function run(options) {
  const phase = options.trial ? 'trial' : 'valid';
  const target = options.trial ? TRIAL_TARGET : VALID_TARGET;
  const dirty = git('status', '--porcelain')?.split(/\r?\n/).filter(Boolean) ?? [];
  if (phase === 'valid' && dirty.length && !options.allowDirty) {
    throw new Error('Commit the perf build before valid P2 trials, or explicitly pass --allow-dirty.');
  }
  let complete = validRows(phase);
  if (complete >= target) {
    console.log(`Already have ${complete} ${phase} P2 rows. Nothing to run.`);
    return;
  }

  const perfUrl = new URL(options.url);
  perfUrl.searchParams.set('perf', '1');
  const session = {
    id: `p2-${Date.now()}`,
    measure: 'P2', phase, startedAt: new Date().toISOString(), finishedAt: null,
    appUrl: perfUrl.href, target: options.target,
    git: { commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), dirty },
    browser: 'Google Chrome headed through Playwright', viewport: VIEWPORT,
    os: { name: os.type(), release: os.release(), arch: os.arch() },
    network: options.network, valid: complete, invalid: 0,
  };
  saveMeta(session);

  const context = await launch();
  const page = context.pages()[0] ?? await context.newPage();
  const marks = [];
  page.on('console', message => {
    const text = message.text();
    if (!text.startsWith('[HS-PERF] ')) return;
    try { marks.push(JSON.parse(text.slice('[HS-PERF] '.length))); } catch { /* ignore malformed output */ }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let invalid = 0;
  try {
    while (complete < target && invalid < MAX_INVALID) {
      await cdp.send('Network.clearBrowserCache');
      const start = marks.length;
      const trial = complete + 1;
      let row;
      try {
        await page.goto(perfUrl.href, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
        if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('Not signed in; run with --login first.');
        const mark = await p2Mark(page, { marks, index: start });
        if (!mark) throw new Error(`No hs-markers-interactive mark within ${TIMEOUT_MS / 1000} seconds.`);
        row = {
          class: 'desktop_chrome', trial, status: phase, p2_ms: Number(mark.ms).toFixed(3),
          cache_mode: mark.cacheMode ?? 'unknown', hydrants_drawn: mark.hydrantsDrawn ?? '',
          view: 'signed-in station account', network: options.network, note: '', iso_time: mark.ts,
        };
        complete += 1;
        session.valid = complete;
      } catch (error) {
        invalid += 1;
        session.invalid = invalid;
        row = {
          class: 'desktop_chrome', trial, status: 'invalid', p2_ms: '', cache_mode: '', hydrants_drawn: '',
          view: 'signed-in station account', network: options.network,
          note: error instanceof Error ? error.message : 'Unknown P2 error', iso_time: new Date().toISOString(),
        };
      }
      append(row);
      saveMeta(session);
      console.log(`P2 ${row.status} ${trial}: ${row.p2_ms || row.note}`);
      if (complete < target) await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
    }
  } finally {
    session.finishedAt = new Date().toISOString();
    saveMeta(session);
    await context.close();
  }
  if (complete < target) throw new Error(`Stopped after ${invalid} invalid P2 attempts; ${complete}/${target} ${phase} rows recorded.`);
}

const options = args(process.argv.slice(2));
await (options.login ? login(options) : run(options));
