// Check-in load test: starts the real API as a separate process on a file-based SQLite database,
// creates 600 synthetic students (is_test = 1) in one club with one open session, then fires
// N simultaneous check-ins (100, 300, 500) over real HTTP and reports p50 / p95 / p99 and error rate.
//   node load-tests/checkin-load.mjs            (3 trials per level)
//   TRIALS=1 node load-tests/checkin-load.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';
import { openDb } from '../apps/api/src/schema.js';
import { makeToken, slotNow } from '../apps/api/src/lib/tokens.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEVELS = (process.env.LEVELS || '100,300,500').split(',').map(Number);
const TRIALS = Number(process.env.TRIALS || 3);
const USERS = Math.max(...LEVELS) + 100;
const PORT = Number(process.env.LOAD_PORT || 4555);
const SECRET = 'load-test-secret-with-enough-length-1234';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campuscred-load-'));
const dbPath = path.join(dir, 'load.db');

// ---- seed ----
const db = openDb(dbPath);
const now = new Date().toISOString();
const campus = db.prepare("INSERT INTO campuses(name,city,lat,lng,radius_m) VALUES ('Load campus','Bengaluru',12.9716,77.5946,500)").run().lastInsertRowid;
const mkUser = db.prepare("INSERT INTO users(campus_id,name,email,student_code,password_hash,system_role,is_test,created_at) VALUES (?,?,?,?, 'x', ?, 1, ?)");
const coord = Number(mkUser.run(campus, 'Load coordinator', 'coord@load.test', 'LC0', 'student', now).lastInsertRowid);
const club = db.prepare("INSERT INTO clubs(campus_id,name,capacity,status,is_test,created_at) VALUES (?, 'Load Club', 5000, 'approved', 1, ?)").run(campus, now).lastInsertRowid;
const day = db.prepare("INSERT INTO club_days(campus_id,date,title) VALUES (?, ?, 'Load day')").run(campus, now.slice(0, 10)).lastInsertRowid;
const act = db.prepare("INSERT INTO activities(club_id,club_day_id,topic,format,status,created_at) VALUES (?,?,'Load test','on_the_spot','approved',?)").run(club, day, now).lastInsertRowid;
const secret = 'load-session-secret';
const sid = Number(db.prepare(`INSERT INTO sessions(kind,activity_id,club_id,opened_by,opened_at,closes_at,late_after,status,secret,geo_mode)
  VALUES ('club_day',?,?,?,?,?,?,'open',?, 'off')`).run(act, club, coord, now, new Date(Date.now() + 6 * 3600e3).toISOString(), new Date(Date.now() + 5 * 3600e3).toISOString(), secret).lastInsertRowid);
const ids = [];
db.transaction(() => {
  for (let i = 0; i < USERS; i++) {
    const id = Number(mkUser.run(campus, `Load ${i}`, `l${i}@load.test`, `LD${i}`, 'student', now).lastInsertRowid);
    db.prepare("INSERT INTO memberships(club_id,user_id,position,is_primary,status,created_at) VALUES (?,?,'member',1,'active',?)").run(club, id, now);
    ids.push(id);
  }
})();
db.close();

// ---- start the real server in its own process ----
const server = spawn(process.execPath, [path.join(here, '../apps/api/src/server.js')], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'u'), CERT_DIR: path.join(dir, 'c'), JWT_SECRET: SECRET, RATE_LIMIT: 'off' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const base = `http://127.0.0.1:${PORT}/api/v1`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }

const resetDb = openDb(dbPath);
const tokens = ids.map((id) => jwt.sign({ id }, SECRET));
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.ceil((p / 100) * arr.length) - 1)];

async function burst(n) {
  resetDb.prepare('DELETE FROM attendance').run();
  const body = JSON.stringify({ token: makeToken({ id: sid, secret }, slotNow(Date.now(), 20)) });
  const t0 = performance.now();
  const results = await Promise.all(tokens.slice(0, n).map(async (tk) => {
    const s = performance.now();
    try {
      const res = await fetch(`${base}/checkin`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }, body });
      await res.arrayBuffer();
      return { ms: performance.now() - s, status: res.status };
    } catch (e) { return { ms: performance.now() - s, status: 0, err: e.code || e.message }; }
  }));
  const wall = performance.now() - t0;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const ok = results.filter((r) => r.status === 201).length;
  const rows = resetDb.prepare('SELECT COUNT(*) n, COUNT(DISTINCT user_id) d FROM attendance').get();
  return { concurrent: n, ok, errors: n - ok, error_rate_pct: Math.round(((n - ok) / n) * 10000) / 100, p50_ms: Math.round(pct(lat, 50)), p95_ms: Math.round(pct(lat, 95)),
    p99_ms: Math.round(pct(lat, 99)), max_ms: Math.round(lat.at(-1)), wall_ms: Math.round(wall), rows_saved: rows.n, distinct_students: rows.d };
}

// the coordinator's live screen polls this while 500 students are checking in
async function liveScreen(n) {
  const tk = jwt.sign({ id: coord }, SECRET);
  const lat = [];
  for (let i = 0; i < 20; i++) { const s = performance.now(); const r = await fetch(`${base}/sessions/${sid}/live`, { headers: { authorization: `Bearer ${tk}` } }); await r.arrayBuffer(); lat.push(performance.now() - s); }
  lat.sort((a, b) => a - b);
  return { roster: n, polls: 20, p50_ms: Math.round(pct(lat, 50)), p95_ms: Math.round(pct(lat, 95)), max_ms: Math.round(lat.at(-1)) };
}

// control: the same number of requests against a trivial endpoint shows how much of the latency is plain HTTP + the test machine
async function control(n) {
  const t = await Promise.all(Array.from({ length: n }, async () => { const s = performance.now(); const r = await fetch(`${base}/health`); await r.arrayBuffer(); return performance.now() - s; }));
  t.sort((a, b) => a - b);
  return { endpoint: 'GET /health (no auth, no database)', concurrent: n, p50_ms: Math.round(pct(t, 50)), p95_ms: Math.round(pct(t, 95)), max_ms: Math.round(t.at(-1)) };
}

// realistic arrival pattern: n check-ins arriving at random moments inside `seconds`
async function spread(n, seconds) {
  resetDb.prepare('DELETE FROM attendance').run();
  const body = () => JSON.stringify({ token: makeToken({ id: sid, secret }, slotNow(Date.now(), 20)) });
  const results = await Promise.all(tokens.slice(0, n).map((tk) => new Promise((resolve) => setTimeout(async () => {
    const s = performance.now();
    try { const res = await fetch(`${base}/checkin`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }, body: body() }); await res.arrayBuffer(); resolve({ ms: performance.now() - s, status: res.status }); }
    catch { resolve({ ms: performance.now() - s, status: 0 }); }
  }, Math.random() * seconds * 1000))));
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const ok = results.filter((r) => r.status === 201).length;
  return { checkins: n, spread_seconds: seconds, arrival_rate_per_s: Math.round((n / seconds) * 10) / 10, ok, errors: n - ok, error_rate_pct: Math.round(((n - ok) / n) * 10000) / 100,
    p50_ms: Math.round(pct(lat, 50)), p95_ms: Math.round(pct(lat, 95)), p99_ms: Math.round(pct(lat, 99)), max_ms: Math.round(lat.at(-1)) };
}

await burst(50); // warm-up
const out = { machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, node: process.version, platform: process.platform }, database: 'SQLite (WAL) on local disk, single API process', trials: [] , live_screen: null };
for (const n of LEVELS) for (let t = 1; t <= TRIALS; t++) { const r = { trial: t, ...(await burst(n)) }; out.trials.push(r); console.log(JSON.stringify(r)); }
resetDb.prepare('DELETE FROM attendance').run();
const full = Math.max(...LEVELS);
for (const tk of tokens.slice(0, full)) { /* fill roster so the live screen is realistic */ }
await burst(full);
out.live_screen = await liveScreen(full);
console.log('live screen', JSON.stringify(out.live_screen));
out.control = [];
for (let i = 0; i < 3; i++) { const c = await control(full); out.control.push(c); console.log('control', JSON.stringify(c)); }
out.spread = await spread(full, Number(process.env.SPREAD_SECONDS || 60));
console.log('spread', JSON.stringify(out.spread));
resetDb.close();
server.kill();

const lines = ['| Concurrent check-ins | Trial | Succeeded | Error rate | p50 | p95 | p99 | Max | Wall time |', '|---|---|---|---|---|---|---|---|---|'];
for (const r of out.trials) lines.push(`| ${r.concurrent} | ${r.trial} | ${r.ok}/${r.concurrent} | ${r.error_rate_pct}% | ${r.p50_ms} ms | ${r.p95_ms} ms | ${r.p99_ms} ms | ${r.max_ms} ms | ${r.wall_ms} ms |`);
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(out, null, 2));
const sp = out.spread;
lines.push('', `Live screen (coordinator polling a roster of ${out.live_screen.roster}): p50 ${out.live_screen.p50_ms} ms, p95 ${out.live_screen.p95_ms} ms.`, '',
  `Control (${out.control[0].endpoint}, ${out.control[0].concurrent} concurrent): p95 ${out.control.map((c) => c.p95_ms).join(' / ')} ms over 3 runs.`, '',
  `Realistic spread: ${sp.checkins} check-ins arriving at random moments over ${sp.spread_seconds} s (${sp.arrival_rate_per_s}/s, the brief's 500 in 5 minutes is 1.7/s): ${sp.ok}/${sp.checkins} succeeded, p50 ${sp.p50_ms} ms, p95 ${sp.p95_ms} ms, p99 ${sp.p99_ms} ms, max ${sp.max_ms} ms.`);
fs.writeFileSync(path.join(here, 'results.md'), lines.join('\n') + '\n');
console.log('\n' + lines.join('\n'));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
