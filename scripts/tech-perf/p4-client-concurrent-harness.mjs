#!/usr/bin/env node
/**
 * HydroScout P4 â€” authenticated Firebase Client SDK concurrent-write harness.
 * Expected location: scripts/tech-perf/p4-client-concurrent-harness.mjs
 * Standalone; intentionally does not import lib/firebase.ts (which may select production).
 * Node >=20, firebase@12.x. No firebase-admin used for measured operations.
 *
 * Modes:
 *   --plan       offline checks only, no authentication/network
 *   --preflight  authenticated read-only validation, saves baseline/metadata
 *   --pilot      1 authenticated write + status restoration, requires --confirm-staging
 *   --run        5 x dispersed + 5 x contended, requires --confirm-staging --observer-ready
 *
 * Required environment variables: NEXT_PUBLIC_STAGING_FIREBASE_API_KEY,
 *   P4_WRITER_EMAIL, P4_WRITER_PASSWORD. Only set credentials in shell/environment,
 *   never in tracked source. --plan needs no credentials.
 * Optional: P4_RESULTS_DIR, P4_WRITER_NAME, P4_WRITER_ROLE.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  getFirestore, doc, getDocFromServer, updateDoc, serverTimestamp,
  arrayUnion
} from 'firebase/firestore';

const PROJECT = 'hydro-scout-staging-2026';
const CONFIG = {
  authDomain: `${PROJECT}.firebaseapp.com`,
  projectId: PROJECT,
  storageBucket: `${PROJECT}.firebasestorage.app`,
  messagingSenderId: '840981831089',
  appId: '1:840981831089:web:94518f453eb5e3bbcbb190'
};
const args = new Set(process.argv.slice(2));
const modes = ['--plan','--preflight','--pilot','--run'].filter(a => args.has(a));
if (modes.length !== 1 || [...args].some(a=>!['--plan','--preflight','--pilot','--run','--confirm-staging','--observer-ready','--accept-audit-entries','--approve-contended-fieldnotes'].includes(a))) throw new Error('Choose exactly one supported mode and known flags only');
const mode = modes[0];
const stamp = () => performance.timeOrigin + performance.now();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fileSafeTime = () => new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const targetDir = process.env.P4_RESULTS_DIR || path.join(os.homedir(), 'Documents', 'HydroScout-TechPerf', 'p4-client-sdk');
let app, auth, db, sessionDir;
let operationalPressure = null; // Determined from real staging records, never guessed

function parseLocalEnv() {
  // Reads API key only, never writer credentials from repository files.
  const envfile = path.resolve('.env.production.local');
  if (!fs.existsSync(envfile)) return;
  for (const line of fs.readFileSync(envfile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(NEXT_PUBLIC_STAGING_FIREBASE_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
function assertIsolation() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error('STOP: Emulator variables set. This harness is for the dedicated cloud staging project only.');
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT)
    throw new Error('STOP: GCLOUD_PROJECT conflicts with test project.');
  if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT)
    throw new Error('STOP: GOOGLE_CLOUD_PROJECT conflicts with test project.');
  const requestedTarget = process.env.NEXT_PUBLIC_FIREBASE_TARGET;
  if (requestedTarget && requestedTarget !== 'staging')
    throw new Error('STOP: NEXT_PUBLIC_FIREBASE_TARGET must be staging.');
  if (process.env.NODE_ENV === 'development')
    throw new Error('STOP: NODE_ENV=development would select emulators in app; use clean production test shell.');
  if (CONFIG.projectId !== PROJECT) throw new Error('STOP: Project isolation guard failed.');
  if (mode === '--pilot' || mode === '--run') {
    if (!args.has('--confirm-staging')) throw new Error('Writes require --confirm-staging');
    if (mode === '--run' && !args.has('--observer-ready'))
      throw new Error('Full run requires independent P5 logger ready and --observer-ready');
  }
}
function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}
function writeCSV(filename, headers, rows) {
  fs.writeFileSync(path.join(sessionDir, filename), [headers.join(','), ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))].join('\r\n') + '\r\n');
}
function persistJson(filename, object) {
  fs.writeFileSync(path.join(sessionDir, filename), JSON.stringify(object, null, 2) + '\n');
}
function iso() { return new Date().toISOString(); }
function exitWithMessage(message) { throw new Error(message); }
function publicConfig() { return {...CONFIG, apiKey: '[REDACTED]'}; }
function gitCommit() { try { return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch { return 'NOT_AVAILABLE'; } }

// Valid app mapping: normal=Operational / Good, reduced=Reduced Pressure / Weak,
// out=Out of Service / Out. We deliberately avoid BFP Reference.
function changedStatus(original) {
  return original === 'Out of Service'
    ? { operationalStatus: 'Operational', pressureStatus: operationalPressure, color: 'green' }
    : { operationalStatus: 'Out of Service', pressureStatus: 'Out', color: 'red' };
}
function statusPressure(original) {
  if (original === 'Operational') return operationalPressure;
  if (original === 'Reduced Pressure') return 'Weak';
  if (original === 'Out of Service') return 'Out';
  if (original === 'BFP Reference') return 'None';
  throw new Error(`Unsupported original operationalStatus: ${original}`);
}
function metadataFor(opStatus) {
  if (opStatus === 'Operational') return {color:'green'};
  if (opStatus === 'Reduced Pressure') return {color:'yellow'};
  if (opStatus === 'Out of Service') return {color:'red'};
  return {color:'gray'};
}
function writerName() {
  return (process.env.P4_WRITER_NAME || 'HydroScout P4 Test Operator').trim();
}
function writerRole() {
  return (process.env.P4_WRITER_ROLE || 'admin').trim();
}
function makePayload(status, token, includeTrackingToken) {
  const nowIso = iso();
  const writer = writerName();
  const registerItem = {
    statusColor: metadataFor(status.operationalStatus).color,
    action: `Status set to ${status.operationalStatus}`,
    by: writer,
    role: writerRole(),
    date: nowIso
  };
  const payload = {
    operationalStatus: status.operationalStatus,
    pressureStatus: status.pressureStatus,
    updatedBy: writer,
    updatedAt: serverTimestamp(),
    register: arrayUnion(registerItem)
  };
  // fieldNotes is an actual app field, via EditHydrantInput.note.
  // Only measured operations receive uniquely matchable fieldNotes.
  // Mark must approve these persistent test notes before the full run.
  if (includeTrackingToken) {
    payload.fieldNotes = arrayUnion({
      user: writer,
      initials: 'P4',
      text: token,
      date: nowIso.slice(0, 10)
    });
  }
  return payload;
}
function msNow() { return stamp(); }

async function openConnection() {
  parseLocalEnv();
  const apiKey = process.env.NEXT_PUBLIC_STAGING_FIREBASE_API_KEY;
  if (!apiKey) exitWithMessage('Missing NEXT_PUBLIC_STAGING_FIREBASE_API_KEY');
  if (!process.env.P4_WRITER_EMAIL || !process.env.P4_WRITER_PASSWORD)
    exitWithMessage('Set P4_WRITER_EMAIL and P4_WRITER_PASSWORD in this PowerShell session. Do not paste credentials into chat.');
  app = initializeApp({...CONFIG, apiKey}, `p4-client-${process.pid}`);
  if (app.options.projectId !== PROJECT) exitWithMessage('STOP: Firebase app is not staging-2026.');
  auth = getAuth(app);
  db = getFirestore(app);
  const credential = await signInWithEmailAndPassword(auth, process.env.P4_WRITER_EMAIL, process.env.P4_WRITER_PASSWORD);
  if (!credential.user || credential.user.isAnonymous) exitWithMessage('Signed-in user is invalid.');
  // Auth identity is never the same as Firestore authorization. Preflight only reads.
  const profileSnap = await getDocFromServer(doc(db,'users',credential.user.uid));
  if (!profileSnap.exists()) throw new Error('STOP: Authenticated user has no /users/{uid} profile');
  const profile = profileSnap.data();
  if (profile.accountType === 'station' || profile.role !== 'admin')
    throw new Error('STOP: This harness requires a staging test user with role=admin and accountType != station');
  console.log(`Authenticated staging admin test account: ${credential.user.uid} (UID only)`);
  return credential.user.uid;
}
async function readBaseline() {
  const result = [];
  for (let i=1; i<=51; i++) {
    const id = `HYD-${String(i).padStart(3,'0')}`;
    const snap = await getDocFromServer(doc(db,'hydrants',id));
    if (!snap.exists()) throw new Error(`STOP: ${id} does not exist`);
    const data = snap.data();
    if (!['Operational','Reduced Pressure','Out of Service','BFP Reference'].includes(data.operationalStatus))
      throw new Error(`STOP: Unknown status on ${id}: ${String(data.operationalStatus)}`);
    result.push({ id, operationalStatus:data.operationalStatus,
      pressureStatus:data.pressureStatus ?? null,
      registerCount:Array.isArray(data.register) ? data.register.length : 0,
      fieldNotesCount:Array.isArray(data.fieldNotes) ? data.fieldNotes.length : 0,
      barangay:data.barangay ?? null });
  }
  const actualNormalPressures = [...new Set(result.filter(x => x.operationalStatus === 'Operational').map(x=>x.pressureStatus))];
  if (actualNormalPressures.length !== 1 || typeof actualNormalPressures[0] !== 'string' || !actualNormalPressures[0])
    throw new Error('STOP: Cannot infer a single valid Operational pressureStatus from seeded data. Inspect actual app statusToPressureStatus mapping.');
  operationalPressure = actualNormalPressures[0];
  console.log(`Verified Operational pressureStatus from seeded data: ${operationalPressure}`);
  return result;
}
async function verifyStatuses(baseline) {
  const out=[];
  for (const b of baseline) {
    const snap=await getDocFromServer(doc(db,'hydrants',b.id));
    const d = snap.data();
    out.push({id:b.id, status:d?.operationalStatus, pressureStatus:d?.pressureStatus,
      matches:!!d && d.operationalStatus===b.operationalStatus && d.pressureStatus===b.pressureStatus,
      registerCount:Array.isArray(d?.register) ? d.register.length : 0,
      fieldNotesCount:Array.isArray(d?.fieldNotes) ? d.fieldNotes.length : 0 });
  }
  return out;
}
async function settleWrite(hydrantId, payload, info) {
  const begin=msNow();
  const ref=doc(db,'hydrants',hydrantId);
  let firstErrorCode='', ack=null, outcome='';
  const timeout=30_000;
  // Timeout never cancels Firestore's SDK internal queued write: stop further
  // workload on no_ack and do not claim recovery as final until manually checked.
  const timed = p => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('No acknowledgment in 30 s'),{code:'no_ack'})),timeout);
    Promise.resolve(p).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
  try {
    await timed(updateDoc(ref,payload));
    ack=msNow(); outcome='ok';
  } catch(e) {
    firstErrorCode=String(e?.code||e?.message||'unknown');
    if (e?.code==='no_ack') outcome='no_ack';
    else {
      await delay(500);
      try { await timed(updateDoc(ref,payload)); ack=msNow(); outcome='recovered'; }
      catch(e2) { outcome = e2?.code==='no_ack' ? 'no_ack' : 'unrecovered'; info.retryErrorCode=String(e2?.code||e2?.message||'unknown'); }
    }
  }
  return { ...info, t_issue_ms:begin, t_ack_ms:ack, ack_ms:ack===null?'':+(ack-begin).toFixed(3), outcome,
    first_error_code:firstErrorCode, retry_ack_ms:outcome==='recovered'?ack:'', note:info.retryErrorCode||''};
}
const writeColumns = ['run','workload','write_seq','hydrant_id','token','t_issue_ms','t_ack_ms','ack_ms','outcome','first_error_code','retry_ack_ms','note'];
const runColumns = ['run','workload','attempted','ok','recovered','unrecovered','no_ack','first_issue_ms','last_ack_ms','elapsed_s','throughput_wps','error_rate_pct','note'];
function writeRecord(rows, row) { rows.push(row); writeCSV('p4_writes.csv',writeColumns,rows); }
function validTime(x) { return x !== '' && x !== null && x !== undefined && Number.isFinite(Number(x)) && Number(x)>0; }
async function restoreStatuses(baseline, onRecord=()=>{}) {
  const records=[];
  for (const b of baseline) {
    const ref=doc(db,'hydrants',b.id);
    const snap=await getDocFromServer(ref);
    if (!snap.exists()) throw new Error(`Restoration STOP: missing ${b.id}`);
    if (snap.data().operationalStatus===b.operationalStatus && snap.data().pressureStatus===b.pressureStatus) continue;
    const status={operationalStatus:b.operationalStatus, pressureStatus:b.pressureStatus ?? statusPressure(b.operationalStatus)};
    const r=await settleWrite(b.id,makePayload(status,`RESTORE-${b.id}`,false),{run:'restore',workload:'restore',write_seq:records.length+1,hydrant_id:b.id,token:''});
    records.push(r);
    onRecord(r);
    if (r.outcome!=='ok'&&r.outcome!=='recovered')
      throw new Error(`STOP: Restoration not acknowledged for ${b.id}: ${r.outcome}`);
  }
  return records;
}
async function executeWorkload(run,workload,baseline,allWrites,runSummaries) {
  const before=await verifyStatuses(baseline);
  persistJson(`verify-before-${workload}-${run}.json`,before);
  if (!before.every(x=>x.matches)) throw new Error('STOP: Starting statuses differ from captured baseline');
  const target = workload==='dispersed' ? baseline.slice(0,50) : [baseline[0]];
  const useDocs = workload==='dispersed' ? target : Array(50).fill(target[0]);
  // Warm-up on spare hydrant (HYD-051), then restore the status.
  const spare=baseline[50];
  const warm=await settleWrite(spare.id,makePayload(changedStatus(spare.operationalStatus),'WARMUP',false),
    {run,workload:'warmup',write_seq:0,hydrant_id:spare.id,token:'warmup'});
  writeRecord(allWrites,warm);
  if (warm.outcome!=='ok'&&warm.outcome!=='recovered') throw new Error('STOP: Warmup unsuccessful; manual status inspection required');
  // Warm-up is not a measured write. Restore and verify HYD-051 BEFORE starting 50 writes.
  const spareRestore=await restoreStatuses([spare],r=>writeRecord(allWrites,r));
  const spareVerified=await verifyStatuses([spare]);
  persistJson(`verify-warmup-${workload}-${run}.json`,spareVerified);
  if (!spareVerified.every(x=>x.matches)) throw new Error('STOP: Warmup restoration verification failed');
  const tokenBase=`P5-${workload}-${run}-${crypto.randomUUID().slice(0,8)}`;
  // Issue promises without await between updateDoc calls.
  const tasks=useDocs.map((b,index)=>{
    const status=changedStatus(b.operationalStatus);
    const token=`${tokenBase}-${String(index+1).padStart(2,'0')}`;
    return settleWrite(b.id,makePayload(status,token,true),
      {run,workload,write_seq:index+1,hydrant_id:b.id,token});
  });
  const settled=await Promise.allSettled(tasks);
  const rows=settled.map((s,i) => s.status==='fulfilled' ? s.value : {
    run,workload,write_seq:i+1,hydrant_id:useDocs[i].id,token:'',t_issue_ms:'',t_ack_ms:'',ack_ms:'',
    outcome:'unrecovered',first_error_code:'harness_exception',retry_ack_ms:'',note:String(s.reason)
  });
  allWrites.push(...rows);
  const issueTimes=rows.filter(r=>validTime(r.t_issue_ms)).map(r=>Number(r.t_issue_ms));
  const first=issueTimes.length?Math.min(...issueTimes):null;
  const acks=rows.filter(r=>validTime(r.t_ack_ms)).map(r=>Number(r.t_ack_ms));
  const last=acks.length?Math.max(...acks):null;
  const ok=rows.filter(r=>r.outcome==='ok').length;
  const recovered=rows.filter(r=>r.outcome==='recovered').length;
  const unrecovered=rows.filter(r=>r.outcome==='unrecovered').length;
  const no_ack=rows.filter(r=>r.outcome==='no_ack').length;
  const elapsed=last===null||first===null?null:(last-first)/1000;
  const summary={run,workload,attempted:50,ok,recovered,unrecovered,no_ack,
    first_issue_ms:first??'',last_ack_ms:last??'',elapsed_s:elapsed===null?'':+elapsed.toFixed(4),
    throughput_wps:elapsed&&elapsed>0?+((ok+recovered)/elapsed).toFixed(3):'',
    error_rate_pct:+(((recovered+unrecovered+no_ack)/50)*100).toFixed(2),
    note:'Error rate includes recovered, unrecovered, no_ack; first-attempt errors and timeouts preserved in per-write CSV.'};
  runSummaries.push(summary);
  writeCSV('p4_writes.csv',writeColumns,allWrites);
  writeCSV('p4_runs.csv',runColumns,runSummaries);
  // Ensure all potentially late acknowledgments have time to settle before restoration.
  await delay(30_000);
  if (no_ack) throw new Error(`STOP: ${no_ack} no_ack writes may land late; manual verification required before restoration.`);
  const restored=await restoreStatuses(baseline,r=>writeRecord(allWrites,r));
  const checked=await verifyStatuses(baseline);
  persistJson(`verify-${workload}-${run}.json`,checked);
  if (!checked.every(x=>x.matches)) throw new Error('STOP: status restoration verification failed');
  console.log(`${workload} run ${run}: ${ok} ok, ${recovered} recovered, ${unrecovered} unrecovered, ${no_ack} no_ack; throughput ${summary.throughput_wps} writes/s`);
  await delay(60_000);
}

async function main() {
  assertIsolation();
  console.log(`P4 mode: ${mode}; project: ${PROJECT}; Admin SDK: NOT USED`);
  console.log('The app register/fieldNotes audit additions persist; status restoration is not a full document rollback.');
  if (mode==='--plan') {
    console.log(JSON.stringify({mode,project:PROJECT,planned:{dispersed:5,contended:5,writesPerRun:50},
      requires:'Admin-capable staging writer, independent P5 listener ready for --run, Mark approval of fieldNotes tokens for both workloads and append-only audit retention',
      files:['p4_writes.csv','p4_runs.csv','run_meta.json','baseline.json','verify-*.json']},null,2));
    return;
  }
  const uid=await openConnection();
  sessionDir=path.join(targetDir,`${mode.slice(2)}-${fileSafeTime()}`);
  fs.mkdirSync(sessionDir,{recursive:true});
  const baseline=await readBaseline();
  persistJson('baseline.json',baseline);
  persistJson('run_meta.json',{project:PROJECT,mode,startedAt:iso(),
    firebaseConfig:publicConfig(),sdk:'Firebase JS Client SDK',uid,
    node:process.version,platform:process.platform,osRelease:os.release(),cpu:os.cpus()[0]?.model,
    memoryGb:+(os.totalmem()/1024**3).toFixed(2),gitCommit:gitCommit(),
    observer:'P5 independent read-only Client SDK; record P5 session ID separately',network:'RECORD_MANUALLY',speedtestBefore:'RECORD_MANUALLY',speedtestAfter:'RECORD_MANUALLY',
    note:'No admin SDK; status fields restored, register/fieldNotes audit entries intentionally retained.'});
  console.log(`Baseline saved, 51 hydrants, evidence folder: ${sessionDir}`);
  if (mode==='--preflight') {
    console.log('READ-ONLY PREFLIGHT PASS. Authentication succeeded; write permissions NOT YET PROVEN.');
    return;
  }
  if (!args.has('--accept-audit-entries')) throw new Error('STOP: Writes append persistent register/fieldNotes entries. Obtain Mark approval, then use --accept-audit-entries.');
  const writes=[], summaries=[];
  writeCSV('p4_writes.csv',writeColumns,writes);
  writeCSV('p4_runs.csv',runColumns,summaries);
  if (mode==='--pilot') {
    const b=baseline[0];
    const pilotToken=`P5-pilot-0-${crypto.randomUUID().slice(0,8)}`;
    const row=await settleWrite(b.id,makePayload(changedStatus(b.operationalStatus),pilotToken,true),
      {run:'pilot',workload:'pilot',write_seq:1,hydrant_id:b.id,token:pilotToken});
    writes.push(row);
    writeCSV('p4_writes.csv',writeColumns,writes);
    if (row.outcome!=='ok'&&row.outcome!=='recovered') throw new Error('STOP: Pilot unacknowledged; inspect remote data before recovering');
    await restoreStatuses(baseline,r=>writeRecord(writes,r));
    const verified=await verifyStatuses(baseline);
    persistJson('verify-pilot.json',verified);
    if (!verified.every(r=>r.matches)) throw new Error('STOP: Pilot restoration failed');
    console.log('Pilot PASS: status restored and verified. Audit register entry remains.');
    return;
  }
  if (!args.has('--approve-contended-fieldnotes'))
    throw new Error('STOP: Mark approval required for unique dispersed and contended tokens in fieldNotes; add --approve-contended-fieldnotes only after approval.');
  try {
    for (let n=1;n<=5;n++) await executeWorkload(n,'dispersed',baseline,writes,summaries);
    console.log('Rest period between workloads: 5 minutes');
    await delay(5*60_000);
    for (let n=1;n<=5;n++) await executeWorkload(n,'contended',baseline,writes,summaries);
  } catch(e) {
    persistJson('STOPPED.json',{at:iso(),reason:String(e?.stack||e),
      action:'Do not resume or issue more writes until any no_ack or remote statuses have been assessed.'});
    throw e;
  }
  const verified=await verifyStatuses(baseline);
  persistJson('verify-final.json',verified);
  if (!verified.every(r=>r.matches)) throw new Error('STOP: Final status baseline verification failed');
  console.log('P4 harness run completed; 10 runs recorded. Await P5 observer CSV before calling joint P4/P5 complete.');
}

try { await main(); }
catch(e) { console.error('P4 STOP:',e?.message||e); process.exitCode=1; }
finally {
  if (auth) { try {await signOut(auth);} catch {} }
  if (app) { try {await deleteApp(app);} catch {} }
}

