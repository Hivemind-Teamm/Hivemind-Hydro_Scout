#!/usr/bin/env node
/**
 * HydroScout P5: read-only independent Firebase Client SDK observation logger.
 * Place at scripts/tech-perf/p5-client-observation-logger.mjs
 * Requires Node 20+, firebase 12.x (installed in the HydroScout repository).
 *
 * --plan: offline validation; --observe: authenticate and subscribe to staging.
 * This program NEVER writes to Firestore. No credentials are saved in evidence.
 * Raw observations do NOT guarantee one callback per write: Firestore can coalesce.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, onSnapshot } from 'firebase/firestore';

const PROJECT = 'hydro-scout-staging-2026';
const CONFIG = {
  authDomain: `${PROJECT}.firebaseapp.com`,
  projectId: PROJECT,
  storageBucket: `${PROJECT}.firebasestorage.app`,
  messagingSenderId: '840981831089',
  appId: '1:840981831089:web:94518f453eb5e3bbcbb190',
};
const flags = new Set(process.argv.slice(2));
const mode = [...flags].filter(x => ['--plan', '--observe'].includes(x));
if (mode.length !== 1 || [...flags].some(x => !['--plan','--observe','--confirm-staging'].includes(x))) {
  throw new Error('Usage: node p5-client-observation-logger.mjs --plan | --observe --confirm-staging');
}
const observedColumns = [
  'session_id','callback_seq','change_seq','hydrant_id','change_type',
  'received_epoch_ms','server_updated_at_ms','server_to_receive_ms',
  'from_cache','has_pending_writes','document_pending_writes',
  'operational_status','pressure_status','new_p4_tokens','new_p4_token_count',
  'token_match_quality','note'
];
let sessionDir, app, auth, unsubscribe, cleaned = false, stopping = false;
let rows = [], events = [], callbackSeq = 0, initialized = false;
let lastNotes = new Map();
const sessionId = `p5-${new Date().toISOString().replace(/[.:]/g,'-')}-${process.pid}`;
const resultRoot = process.env.P5_RESULTS_DIR || path.join(os.homedir(),'Documents','HydroScout-TechPerf','p5-client-sdk');
const iso = () => new Date().toISOString();
const epochMs = () => performance.timeOrigin + performance.now();
function assertIsolation() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error('STOP: Emulator environment is set.');
  for (const envName of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT']) {
    if (process.env[envName] && process.env[envName] !== PROJECT)
      throw new Error(`STOP: ${envName} conflicts with staging.`);
  }
  if (process.env.NEXT_PUBLIC_FIREBASE_TARGET && process.env.NEXT_PUBLIC_FIREBASE_TARGET !== 'staging')
    throw new Error('STOP: Firebase target is not staging.');
  if (CONFIG.projectId !== PROJECT) throw new Error('STOP: Wrong Firebase project.');
}
function loadApiKeyOnly() {
  if (process.env.NEXT_PUBLIC_STAGING_FIREBASE_API_KEY) return;
  const p = path.resolve('.env.production.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p,'utf8').split(/\r?\n/)) {
    const m = /^\s*NEXT_PUBLIC_STAGING_FIREBASE_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (m) { process.env.NEXT_PUBLIC_STAGING_FIREBASE_API_KEY = m[1].replace(/^['"]|['"]$/g,''); break; }
  }
}
function cell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}
function writeCsv() {
  if (!sessionDir) return;
  const body = [observedColumns.join(','), ...rows.map(row => observedColumns.map(key => cell(row[key])).join(','))].join('\r\n')+'\r\n';
  const target = path.join(sessionDir,'p5_observed.csv');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp,target);
}
function recordEvent(type, data={}) {
  events.push({at:iso(),type,...data});
  if (sessionDir) fs.writeFileSync(path.join(sessionDir,'p5_events.json'),JSON.stringify(events,null,2)+'\n');
}
function notesFor(docData) {
  const notes = Array.isArray(docData.fieldNotes) ? docData.fieldNotes : [];
  return new Set(notes.map(x => typeof x?.text === 'string' ? x.text : '').filter(x => /^P5-(?:dispersed|contended|pilot)-\d+-/.test(x)));
}
function snapshotCallback(snap) {
  const arrived = epochMs();
  const seq = ++callbackSeq;
  const accepted = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
  if (!initialized) {
    if (!accepted) { recordEvent('initial_snapshot_skipped',{seq,reason:'cache_or_pending'}); return; }
    for (const d of snap.docs) lastNotes.set(d.id,notesFor(d.data()));
    initialized = true;
    recordEvent('ready',{seq,hydrants:snap.size,atEpochMs:arrived});
    console.log(`P5 READY: initial server snapshot received (${snap.size} hydrants). Coordinate P4 start now.`);
    return;
  }
  if (!accepted) { recordEvent('snapshot_skipped',{seq,reason:'cache_or_pending'}); return; }
  let changeSeq = 0;
  let visibleTokensThisCallback = 0;
  for (const change of snap.docChanges()) {
    if (change.type === 'removed' || change.doc.metadata.hasPendingWrites) continue;
    const d = change.doc.data();
    const current = notesFor(d);
    const previous = lastNotes.get(change.doc.id) ?? new Set();
    const newTokens = [...current].filter(x => !previous.has(x));
    lastNotes.set(change.doc.id,current);
    visibleTokensThisCallback += newTokens.length;
    const serverMs = d.updatedAt && typeof d.updatedAt.toMillis === 'function' ? d.updatedAt.toMillis() : null;
    // This measures relative to serverTimestamp, NOT P4 issue-to-observation propagation.
    // Cross-computer clock differences must be recorded separately before interpreting this value.
    const elapsed = serverMs === null ? '' : +(arrived-serverMs).toFixed(3); // Diagnostic only, NOT end-to-end latency
    rows.push({
      session_id:sessionId,callback_seq:seq,change_seq:++changeSeq,
      hydrant_id:change.doc.id,change_type:change.type,
      received_epoch_ms:+arrived.toFixed(3),server_updated_at_ms:serverMs ?? '',
      server_to_receive_ms:elapsed,from_cache:snap.metadata.fromCache,
      has_pending_writes:snap.metadata.hasPendingWrites,
      document_pending_writes:change.doc.metadata.hasPendingWrites,
      operational_status:d.operationalStatus ?? '',pressure_status:d.pressureStatus ?? '',
      new_p4_tokens:newTokens.join(';'),new_p4_token_count:newTokens.length,
      token_match_quality:newTokens.length === 1 ? 'single_token_visible' : newTokens.length > 1 ? 'coalesced_multiple_tokens' : 'no_token_visible',
      note:newTokens.length > 1 ? 'Multiple new tokens visible in one callback; NOT distinct callback timings.' : 'Raw snapshot observation. One callback does not guarantee one write.'
    });
  }
  if (changeSeq) {
    writeCsv();
    recordEvent('changed_documents',{seq,changedDocs:changeSeq,newTokensVisible:visibleTokensThisCallback});
    console.log(`P5 callback ${seq}: ${changeSeq} changed hydrant document(s); ${visibleTokensThisCallback} new token(s); ${rows.length} raw row(s).`);
  }
}
async function finish(reason='operator_stopped') {
  if (stopping) return;
  stopping=true;
  recordEvent('stop',{reason,rows:rows.length,callbacks:callbackSeq});
  writeCsv();
  try { unsubscribe?.(); } catch {}
  try { if (auth) await signOut(auth); } catch {}
  try { if (app) await deleteApp(app); } catch {}
  cleaned=true;
  console.log(`P5 STOPPED: ${rows.length} observation row(s). Results: ${sessionDir || 'not started'}`);
}
async function main() {
  assertIsolation();
  if (mode[0] === '--plan') {
    console.log(JSON.stringify({mode:'--plan',project:PROJECT,readOnly:true,auth:'separate Firebase test account',
      output:['p5_observed.csv','p5_events.json','p5_run_meta.json'],
      limitation:'Firestore snapshots can coalesce. Server timestamp is not P4 issue timestamp.'},null,2));
    return;
  }
  if (!flags.has('--confirm-staging')) throw new Error('STOP: --observe requires --confirm-staging');
  loadApiKeyOnly();
  const apiKey=process.env.NEXT_PUBLIC_STAGING_FIREBASE_API_KEY;
  const email=process.env.P5_OBSERVER_EMAIL;
  const password=process.env.P5_OBSERVER_PASSWORD;
  if (!apiKey) throw new Error('Missing NEXT_PUBLIC_STAGING_FIREBASE_API_KEY in environment or .env.production.local');
  if (!email || !password) throw new Error('Set P5_OBSERVER_EMAIL and P5_OBSERVER_PASSWORD in this shell; never paste them into chat.');
  sessionDir=path.join(resultRoot,sessionId);
  fs.mkdirSync(sessionDir,{recursive:true});
  writeCsv();
  fs.writeFileSync(path.join(sessionDir,'p5_run_meta.json'),JSON.stringify({
    project:PROJECT,startedAt:iso(),sessionId,readOnly:true,
    sdk:'Firebase JS Client SDK',node:process.version,platform:process.platform,
    osRelease:os.release(),cpu:os.cpus()[0]?.model,
    writerComputerClockComparison:'RECORD_BEFORE_ANALYSIS',
    note:'Raw observer callbacks; token-to-write comparison requires P4 CSV; no assumption of one callback per write. Server-to-receive may be negative due to clock offset.'
  },null,2)+'\n');
  app=initializeApp({...CONFIG,apiKey},`p5-observe-${process.pid}`);
  auth=getAuth(app);
  const credential=await signInWithEmailAndPassword(auth,email,password);
  if (credential.user.isAnonymous) throw new Error('STOP: Anonymous auth is not acceptable');
  const db=getFirestore(app);
  console.log(`P5 authenticated to ${PROJECT}; UID ${credential.user.uid} (no password saved).`);
  console.log('P5 listener starting. Do NOT start P4 until P5 READY appears. Press Enter after the P4 session completes.');
  unsubscribe=onSnapshot(collection(db,'hydrants'),{includeMetadataChanges:true},snapshotCallback,err=>{
    console.error('P5 LISTENER ERROR:',err.code||'',err.message);
    recordEvent('listener_error',{code:String(err.code||''),message:err.message});
    void finish('listener_error').then(()=>{process.exitCode=1;});
  });
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.once('data',()=>{void finish('operator_pressed_enter');});
  process.on('SIGINT',()=>{void finish('SIGINT');});
  process.on('SIGTERM',()=>{void finish('SIGTERM');});
}
try { await main(); }
catch(err) {
  console.error('P5 STOP:',err?.message||err);
  recordEvent('fatal_error',{message:String(err?.message||err)});
  await finish('fatal_error');
  process.exitCode=1;
}

