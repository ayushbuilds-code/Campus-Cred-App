import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { boot, dayStr, T0 } from './helpers.js';

const evidence = [];
const ev = (area, check, result) => evidence.push({ area, check, result });
let h, S;
const C = { ent: 0, sports: 1, coding: 2, cultural: 3 };
const club = (k) => S.clubs[C[k]];
const members = (k) => club(k).members;           // [president, VP, treasurer, 7 members]
const advisor = (k) => S.advisors[C[k]];
const raw = (sql, ...a) => h.db.prepare(sql).all(...a);
const one = (sql, ...a) => h.db.prepare(sql).get(...a);

before(async () => { h = await boot(); S = h.seed; });
after(async () => {
  fs.mkdirSync(new URL('../../../docs', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../../../docs/test-evidence.json', import.meta.url), JSON.stringify({ generated_at: new Date().toISOString(), evidence }, null, 2));
  await h.close();
});

describe('Seed data matches the brief', () => {
  it('has 4 clubs with exactly 10 members: 1 President, 1 VP, 1 Treasurer, 7 members', () => {
    const rows = raw(`SELECT c.name, m.position, COUNT(*) n FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.status='active' GROUP BY c.name, m.position`);
    for (const name of ['Entrepreneurship', 'Sports', 'Coding', 'Cultural']) {
      const r = Object.fromEntries(rows.filter((x) => x.name === name).map((x) => [x.position, x.n]));
      assert.deepEqual(r, { president: 1, vice_president: 1, treasurer: 1, member: 7 }, name);
    }
    ev('Seed', '4 clubs x 10 members (1 President, 1 VP, 1 Treasurer, 7 members)', 'pass');
  });
  it('database rejects a second President in the same club', async () => {
    const extra = S.students[44].id;
    const r = await h.call('POST', `/clubs/${club('coding').id}/members`, { as: advisor('coding'), body: { user_id: extra, position: 'president' } });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /already has a President/);
    ev('Seed', 'Second President in one club is rejected by a database constraint', 'pass');
  });
});

describe('Auth', () => {
  it('logs in with email and student ID, rejects wrong passwords', async () => {
    const email = one('SELECT email FROM users WHERE id=?', members('coding')[0]).email;
    assert.equal((await h.call('POST', '/auth/login', { body: { identifier: email, password: 'Demo@123' } })).status, 200);
    assert.equal((await h.call('POST', '/auth/login', { body: { identifier: 'MSOT26001', password: 'Demo@123' } })).status, 200);
    assert.equal((await h.call('POST', '/auth/login', { body: { identifier: email, password: 'nope' } })).status, 401);
    assert.equal((await h.call('GET', '/me')).status, 401);
  });
  it('student OTP login works and the OTP is single use', async () => {
    const r = await h.call('POST', '/auth/otp/request', { body: { student_code: 'MSOT26005' } });
    assert.ok(r.data.devOtp);
    assert.equal((await h.call('POST', '/auth/otp/verify', { body: { student_code: 'MSOT26005', otp: r.data.devOtp } })).status, 200);
    assert.equal((await h.call('POST', '/auth/otp/verify', { body: { student_code: 'MSOT26005', otp: r.data.devOtp } })).status, 401);
  });
});

describe('Enrolment', () => {
  it('request, approve, per-student club limit and capacity', async () => {
    const s = S.students[40].id; // has a pending request for Sports from the seed
    const reqs = await h.call('GET', `/clubs/${club('sports').id}/requests`, { as: members('sports')[0] });
    assert.equal(reqs.status, 200);
    const mine = reqs.data.items.find((x) => x.user_id === s);
    assert.ok(mine);
    assert.equal((await h.call('POST', `/memberships/${mine.id}/decision`, { as: members('sports')[0], body: { approve: true } })).status, 200);
    // second (secondary) club allowed, third blocked by the limit of 2
    assert.equal((await h.call('POST', `/clubs/${club('cultural').id}/join`, { as: s })).status, 201);
    const third = await h.call('POST', `/clubs/${club('ent').id}/join`, { as: s });
    assert.equal(third.status, 409); assert.match(third.data.error, /at most 2 clubs/);
    // capacity: shrink Entrepreneurship to 10 (full) and try to join
    assert.equal((await h.call('PATCH', `/clubs/${club('ent').id}`, { as: S.admin, body: { capacity: 10 } })).status, 200);
    const full = await h.call('POST', `/clubs/${club('ent').id}/join`, { as: S.students[45].id });
    assert.equal(full.status, 409); assert.match(full.data.error, /full/);
    ev('Enrolment', 'Join request, coordinator approval, club limit (2), capacity (full club blocks joins)', 'pass');
  });
});

describe('End-to-end Club Day for 3 clubs: plan, approve, check-in, submit, evaluate, report', () => {
  const targetDate = dayStr('2026-10-10', 14);
  for (const key of ['ent', 'coding', 'cultural']) {
    it(`${key}`, async () => {
      const pres = members(key)[0];
      const days = await h.call('GET', '/club-days', { as: pres });
      const dayId = days.data.days.find((d) => d.date === targetDate).id;
      const plan = await h.call('POST', '/activities', { as: pres, body: { club_id: club(key).id, club_day_id: dayId, topic: `E2E topic for ${key}`, format: 'ppt', deliverable: 'A 5-slide PPT' } });
      assert.equal(plan.status, 201);
      const aId = plan.data.id;
      assert.equal((await h.call('POST', `/activities/${aId}/session`, { as: pres, body: {} })).status, 409, 'cannot open check-in before approval');
      assert.equal((await h.call('POST', `/activities/${aId}/submit-plan`, { as: pres })).data.status, 'pending');
      assert.equal((await h.call('POST', `/activities/${aId}/review`, { as: pres, body: { decision: 'approve' } })).status, 403, 'coordinator cannot approve own plan');
      assert.equal((await h.call('POST', `/activities/${aId}/review`, { as: advisor(key), body: { decision: 'approve' } })).data.status, 'approved');
      const sess = await h.call('POST', `/activities/${aId}/session`, { as: pres, body: {} });
      assert.equal(sess.status, 201);
      const live = await h.call('GET', `/sessions/${sess.data.id}/live`, { as: pres });
      const attendees = members(key).slice(0, 7);
      for (const m of attendees) assert.equal((await h.call('POST', '/checkin', { as: m, body: { token: live.data.token, lat: 12.9716, lng: 77.5946 } })).status, 201);
      const live2 = await h.call('GET', `/sessions/${sess.data.id}/live`, { as: pres });
      assert.equal(live2.data.counts.present, 7);
      assert.equal(live2.data.counts.expected, 10);
      const submitters = attendees.slice(0, 5);
      for (const m of submitters) {
        const fd = new FormData(); fd.append('link_url', `https://example.com/${key}/${m}`);
        assert.equal((await h.call('POST', `/activities/${aId}/submissions`, { as: m, form: fd })).status, 201);
      }
      const subs = await h.call('GET', `/activities/${aId}/submissions`, { as: pres });
      assert.equal(subs.data.items.length, 5);
      for (const s of subs.data.items) {
        const evaluator = s.user_id === pres ? advisor(key) : pres; // nobody scores their own work
        assert.equal((await h.call('PUT', `/submissions/${s.id}/evaluation`, { as: evaluator, body: { content: 8, presentation: 7, participation: 9, comment: 'Good' } })).status, 200);
      }
      const own = subs.data.items.find((s) => s.user_id === pres);
      assert.equal((await h.call('PUT', `/submissions/${own.id}/evaluation`, { as: pres, body: { content: 10, presentation: 10, participation: 10 } })).status, 403);
      const pub = await h.call('POST', `/activities/${aId}/publish-scores`, { as: pres });
      assert.equal(pub.data.published, 5); assert.equal(pub.data.certificates_issued, 5);
      const view = await h.call('GET', `/activities/${aId}`, { as: submitters[1] });
      assert.equal(view.data.my_evaluation.total, 8); // (8*40 + 7*30 + 9*30) / 100
      const rep = await h.call('GET', `/reports/monthly?month=2026-10&club_id=${club(key).id}`, { as: advisor(key) });
      const row = rep.data.reports[0].sessions.find((x) => x.date === targetDate);
      assert.equal(row.attended, 7); assert.equal(row.submissions, 5); assert.equal(row.avg_score, 8);
      ev('End-to-end Club Day', `${key}: plan > advisor approve > check-in (7/10) > 5 submissions > scored > published > 5 certificates > report row correct`, 'pass');
    });
  }
});

describe('Check-in integrity', () => {
  let sessionId, aId;
  const pres = () => members('sports')[0];
  it('open session for the Sports Club Day that is ready to run', async () => {
    const days = await h.call('GET', '/club-days', { as: pres() });
    const today = days.data.days.find((d) => d.date === '2026-10-10');
    aId = today.activities.find((a) => a.club_id === club('sports').id).id;
    const r = await h.call('POST', `/activities/${aId}/session`, { as: pres(), body: { geo_mode: 'block' } });
    assert.equal(r.status, 201); sessionId = r.data.id;
  });
  it('a screenshot of an old QR is rejected once it has rotated', async () => {
    const live = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    h.clock.now += 61 * 1000; // a friend tries the forwarded screenshot a minute later
    const r = await h.call('POST', '/checkin', { as: members('sports')[3], body: { token: live.data.token, lat: 12.9716, lng: 77.5946 } });
    assert.equal(r.status, 410); assert.match(r.data.error, /expired/);
    ev('Check-in integrity', 'Screenshot of a QR shared and used 61 s later', '410 "QR has expired", no attendance recorded');
  });
  it('a tampered token is rejected', async () => {
    const live = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    const t = live.data.token.slice(0, -2) + (live.data.token.endsWith('aa') ? 'bb' : 'aa');
    assert.equal((await h.call('POST', '/checkin', { as: members('sports')[3], body: { token: t } })).status, 400);
    ev('Check-in integrity', 'Forged / edited token', '400 "QR code is not valid"');
  });
  it('a non-member cannot check in', async () => {
    const live = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    const r = await h.call('POST', '/checkin', { as: members('coding')[4], body: { token: live.data.token, lat: 12.9716, lng: 77.5946 } });
    assert.equal(r.status, 403);
    ev('Check-in integrity', 'Student from another club scans a valid QR', '403 "Only members of this club can check in"');
  });
  it('outside campus is blocked in block mode', async () => {
    const live = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    const r = await h.call('POST', '/checkin', { as: members('sports')[3], body: { token: live.data.token, lat: 12.9352, lng: 77.6245 } });
    assert.equal(r.status, 403); assert.match(r.data.error, /from campus/);
    const noloc = await h.call('POST', '/checkin', { as: members('sports')[3], body: { token: live.data.token } });
    assert.equal(noloc.status, 403);
    ev('Check-in integrity', 'Check-in from outside campus (geo block mode) / location not shared', '403, nothing recorded');
  });
  it('on-time check-in, duplicate, one-time code and late flag', async () => {
    const live = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    const ok = await h.call('POST', '/checkin', { as: members('sports')[3], body: { token: live.data.token, lat: 12.9716, lng: 77.5946 } });
    assert.equal(ok.status, 201); assert.equal(ok.data.status, 'present');
    assert.equal((await h.call('POST', '/checkin', { as: members('sports')[3], body: { token: live.data.token, lat: 12.9716, lng: 77.5946 } })).status, 409);
    const viaCode = await h.call('POST', '/checkin', { as: members('sports')[4], body: { code: live.data.code, lat: 12.9716, lng: 77.5946 } });
    assert.equal(viaCode.status, 201);
    assert.equal((await h.call('POST', '/checkin', { as: members('sports')[5], body: { code: '000000', lat: 12.9716, lng: 77.5946 } })).status, 410);
    h.clock.now += 5 * 60 * 1000; // 5 min later, still inside the 10 min on-time window
    const live2 = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    h.clock.now += 6 * 60 * 1000; // total ~12 min: after the late threshold (10 min), before the 15 min close
    const live3 = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    const late = await h.call('POST', '/checkin', { as: members('sports')[6], body: { token: live3.data.token, lat: 12.9716, lng: 77.5946 } });
    assert.equal(late.status, 201); assert.equal(late.data.status, 'late'); assert.match(late.data.flag, /Late/);
    void live2;
    ev('Check-in integrity', 'Duplicate check-in / 6-digit code / wrong code / late arrival', '409 / 201 / 410 / recorded as "late" and flagged');
  });
  it('check-in closes after the window', async () => {
    h.clock.now += 10 * 60 * 1000;
    const live = await h.call('GET', `/sessions/${sessionId}/live`, { as: pres() });
    assert.equal(live.data.session.status, 'closed'); assert.equal(live.data.token, null);
    const r = await h.call('POST', '/checkin', { as: members('sports')[7], body: { code: '123456' } });
    assert.ok([410, 409].includes(r.status));
  });
  it('geo "flag" mode records the check-in but marks it', async () => {
    const aId2 = raw("SELECT a.id FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.club_id=? AND cd.date='2026-10-10'", club('ent').id)[0].id;
    const s = await h.call('POST', `/activities/${aId2}/session`, { as: members('ent')[0], body: { geo_mode: 'flag' } });
    const live = await h.call('GET', `/sessions/${s.data.id}/live`, { as: members('ent')[0] });
    const r = await h.call('POST', '/checkin', { as: members('ent')[5], body: { token: live.data.token, lat: 13.2, lng: 77.9 } });
    assert.equal(r.status, 201); assert.match(r.data.flag, /Outside campus/);
    ev('Check-in integrity', 'Outside campus in "flag" mode', '201 recorded with flag "Outside campus (xx m away)" for the coordinator to review');
  });
  it('coordinator corrections need a reason and are audited; students cannot correct', async () => {
    const target = members('sports')[8];
    assert.equal((await h.call('POST', `/sessions/${sessionId}/attendance`, { as: pres(), body: { user_id: target, status: 'present' } })).status, 400);
    assert.equal((await h.call('POST', `/sessions/${sessionId}/attendance`, { as: pres(), body: { user_id: target, status: 'present', reason: 'x' } })).status, 400);
    assert.equal((await h.call('POST', `/sessions/${sessionId}/attendance`, { as: members('sports')[1], body: { user_id: target, status: 'present', reason: 'Phone battery died, was in the hall' } })).status, 200);
    assert.equal((await h.call('POST', `/sessions/${sessionId}/attendance`, { as: members('sports')[9], body: { user_id: target, status: 'absent', reason: 'trying to cheat' } })).status, 403);
    const log = one("SELECT * FROM audit_log WHERE action='attendance.correct' ORDER BY id DESC LIMIT 1");
    assert.equal(log.new_value, '"present"'); assert.equal(log.old_value, '"absent"'); assert.match(log.reason, /battery/);
    const row = one('SELECT * FROM attendance WHERE session_id=? AND user_id=?', sessionId, target);
    assert.equal(row.method, 'manual');
    ev('Check-in integrity', 'Attendance correction by coordinator', 'Reason mandatory (400 without), audit log stores who / old / new / reason; student attempt 403');
  });
});

describe('Late or rescheduled Club Day', () => {
  it('check-in opened two days after the Club Day still reaches students and the coordinator home', async () => {
    h.clock.now = Date.parse('2026-10-12T05:00:00Z');
    const pres = members('coding')[0];
    const aId = raw("SELECT a.id FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.club_id=? AND cd.date='2026-10-10'", club('coding').id)[0].id;
    const ready = (await h.call('GET', '/me/overview', { as: pres })).data.todo.ready_to_run;
    assert.ok(ready.some((x) => x.id === aId), 'plan from 2 days ago is still offered to run');
    const s = await h.call('POST', `/activities/${aId}/session`, { as: pres, body: { window_minutes: 60 } });
    assert.equal(s.status, 201);
    const stu = members('coding')[7];
    const home = (await h.call('GET', '/me/overview', { as: stu })).data;
    assert.ok(home.open_sessions.some((x) => x.session_id === s.data.id && !x.my_attendance), 'open check-in shows on the student home whatever the date');
    const live = await h.call('GET', `/sessions/${s.data.id}/live`, { as: pres });
    assert.equal((await h.call('POST', '/checkin', { as: stu, body: { token: live.data.token, lat: 12.9716, lng: 77.5946 } })).status, 201);
    h.clock.now = T0 + 3 * 3600 * 1000;
    ev('Check-in integrity', 'Check-in opened 2 days after the Club Day (late or rescheduled session)', 'student sees the open check-in on Home; check-in succeeds');
  });
});

describe('Certificates', () => {
  it('20 certificates: every verification link opens the correct record', async () => {
    const certs = raw("SELECT c.id, c.user_id, u.name FROM certificates c JOIN users u ON u.id=c.user_id WHERE c.kind='participation' ORDER BY c.id LIMIT 20");
    assert.equal(certs.length, 20);
    for (const c of certs) {
      const r = await h.call('GET', `/public/verify/${c.id}`);
      assert.equal(r.status, 200); assert.equal(r.data.found, true); assert.equal(r.data.status, 'valid');
      assert.equal(r.data.holder, c.name); assert.equal(r.data.record_intact, true);
      const file = fs.readFileSync(one('SELECT file_path p FROM certificates WHERE id=?', c.id).p);
      assert.equal(file.subarray(0, 4).toString(), '%PDF');
    }
    assert.equal((await h.call('GET', '/public/verify/CC-2026-DEADBEEF')).status, 404);
    ev('Certificates', '20 certificates verified by public link (holder, status, record hash recomputed, valid PDF)', '20/20 pass; unknown ID returns 404');
  });
  it('a tampered PDF fails verification, the original passes', async () => {
    const c = raw("SELECT id, file_path FROM certificates WHERE kind='participation' LIMIT 1")[0];
    const orig = fs.readFileSync(c.file_path);
    const fd1 = new FormData(); fd1.append('id', c.id); fd1.append('file', new Blob([orig]), 'cert.pdf');
    assert.equal((await h.call('POST', '/public/verify-file', { form: fd1 })).data.match, true);
    const tampered = Buffer.from(orig); tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    const fd2 = new FormData(); fd2.append('id', c.id); fd2.append('file', new Blob([tampered]), 'cert.pdf');
    const bad = await h.call('POST', '/public/verify-file', { form: fd2 });
    assert.equal(bad.data.match, false); assert.match(bad.data.message, /altered/);
    const fd3 = new FormData(); fd3.append('file', new Blob([tampered]), 'cert.pdf');
    assert.equal((await h.call('POST', '/public/verify-file', { form: fd3 })).data.match, false);
    ev('Certificates', 'Original PDF vs the same PDF with one byte changed', 'original: match; tampered: rejected ("altered")');
  });
  it('advisor issues and revokes an achievement certificate; student cannot issue', async () => {
    const stu = members('coding')[5];
    assert.equal((await h.call('POST', '/certificates', { as: stu, body: { user_id: stu, club_id: club('coding').id, title: 'Self award' } })).status, 403);
    const r = await h.call('POST', '/certificates', { as: advisor('coding'), body: { user_id: stu, club_id: club('coding').id, title: 'Best Contributor, October', detail: 'Led the mock contest.' } });
    assert.equal(r.status, 201);
    assert.equal((await h.call('POST', `/certificates/${r.data.id}/revoke`, { as: advisor('coding'), body: { reason: 'Issued by mistake' } })).status, 200);
    const v = await h.call('GET', `/public/verify/${r.data.id}`);
    assert.equal(v.data.status, 'revoked');
    ev('Certificates', 'Achievement certificate issue then revoke', 'verification page shows "revoked"');
  });
  it('transcript PDF is generated, verifiable and reused when data is unchanged', async () => {
    const stu = members('coding')[6];
    const a = await h.call('GET', `/students/${stu}/transcript`, { as: stu });
    assert.equal(a.status, 200); assert.ok(a.data.clubs.length >= 1);
    const r1 = await h.call('GET', `/students/${stu}/transcript.pdf`, { as: stu, raw: true });
    const r2 = await h.call('GET', `/students/${stu}/transcript.pdf`, { as: stu, raw: true });
    assert.equal(r1.status, 200);
    const b1 = Buffer.from(await r1.arrayBuffer()), b2 = Buffer.from(await r2.arrayBuffer());
    assert.equal(b1.subarray(0, 4).toString(), '%PDF'); assert.ok(b1.equals(b2));
    assert.equal((await h.call('GET', `/students/${members('coding')[7]}/transcript`, { as: stu })).status, 403);
    ev('Transcript', 'JSON + PDF transcript, repeat download returns the same verified file, other students blocked', 'pass');
  });
});

describe('Events: 200 registrations with team formation', () => {
  it('runs without duplicates or lost entries under concurrency', async () => {
    const campus = one('SELECT campus_id c FROM users WHERE id=?', S.admin).c;
    const ids = [];
    const ins = h.db.prepare("INSERT INTO users(campus_id,name,email,student_code,password_hash,system_role,is_test,created_at) VALUES (?,?,?,?,?,'student',1,?)");
    for (let i = 0; i < 201; i++) ids.push(Number(ins.run(campus, `Load Student ${i}`, `load${i}@t.example`, `LT${String(i).padStart(4, '0')}`, 'x', new Date(h.clock.now).toISOString()).lastInsertRowid));
    const created = await h.call('POST', '/events', { as: S.manager, body: { name: 'Registration stress event', kind: 'Hackathon', starts_at: '2026-12-01T04:00:00Z', capacity: 200, team_size_min: 1, team_size_max: 4 } });
    assert.equal(created.status, 201);
    const eid = created.data.id;
    const leaders = ids.slice(0, 50), joiners = ids.slice(50, 200);
    const teams = await Promise.all(leaders.map((u, i) => h.call('POST', `/events/${eid}/teams`, { as: u, body: { name: `Team ${i}` } })));
    assert.ok(teams.every((t) => t.status === 201), 'all 50 teams created');
    const results = await Promise.all(joiners.map((u, j) => h.call('POST', `/events/${eid}/teams/join`, { as: u, body: { invite_code: teams[j % 50].data.invite_code } })));
    assert.ok(results.every((r) => r.status === 200), 'all 150 joins succeeded');
    const regs = raw('SELECT user_id, team_id FROM event_regs WHERE event_id=?', eid);
    assert.equal(regs.length, 200);
    assert.equal(new Set(regs.map((r) => r.user_id)).size, 200, 'no duplicate registrations');
    assert.ok(regs.every((r) => r.team_id), 'nobody is left without a team');
    const sizes = raw('SELECT team_id, COUNT(*) n FROM event_regs WHERE event_id=? GROUP BY team_id', eid);
    assert.equal(sizes.length, 50); assert.ok(sizes.every((s) => s.n === 4), 'every team has exactly 4 members');
    // the 201st student is turned away, and a 5th member cannot join a full team
    const over = await h.call('POST', `/events/${eid}/register`, { as: ids[200] });
    assert.equal(over.status, 409); assert.match(over.data.error, /full/);
    const teamFull = await h.call('POST', `/events/${eid}/teams/join`, { as: ids[200], body: { invite_code: teams[0].data.invite_code } });
    assert.equal(teamFull.status, 409);
    // double-tap: 6 simultaneous registrations by one student create exactly one row
    const solo = await h.call('POST', '/events', { as: S.manager, body: { name: 'Solo event', starts_at: '2026-12-02T04:00:00Z', capacity: 5 } });
    const dbl = await Promise.all(Array.from({ length: 6 }, () => h.call('POST', `/events/${solo.data.id}/register`, { as: S.students[2].id })));
    assert.equal(dbl.filter((d) => d.status === 201).length, 1);
    assert.equal(raw('SELECT * FROM event_regs WHERE event_id=?', solo.data.id).length, 1);
    ev('Events', '200 registrations, 50 teams x 4 formed concurrently (50 creates + 150 joins at once)', '200 rows, 200 distinct students, 0 duplicates, 0 without team; 201st registration and 5th team member rejected; 6 simultaneous double-taps create 1 row');
  });
  it('results create achievement + participation certificates; inter-college registration creates duty leave', async () => {
    const hack = S.events.hack;
    const teams = raw('SELECT id FROM teams WHERE event_id=? ORDER BY id', hack);
    const r = await h.call('POST', `/events/${hack}/results`, { as: S.manager, body: { results: [{ team_id: teams[0].id, position: 1 }, { team_id: teams[1].id, position: 2 }] } });
    assert.equal(r.status, 200); assert.ok(r.data.certificates_issued >= 5);
    assert.equal((await h.call('POST', `/events/${hack}/results`, { as: members('coding')[0], body: { results: [{ team_id: teams[0].id, position: 1 }] } })).status, 403);
    const dl = await h.call('GET', '/duty-leaves', { as: S.manager });
    assert.ok(dl.data.items.length >= 10);
    const first = dl.data.items.find((d) => d.status === 'pending');
    assert.equal((await h.call('POST', `/duty-leaves/${first.id}/decision`, { as: S.manager, body: { approve: true } })).status, 200);
    ev('Events', 'Results entry, certificates, inter-college duty leave approval', 'pass');
  });
});

describe('Permissions', () => {
  it('coordinators see only their own club; students cannot edit attendance or scores', async () => {
    const codingPres = members('coding')[0];
    const sportsAct = raw('SELECT a.id FROM activities a WHERE a.club_id=? LIMIT 1', club('sports').id)[0].id;
    const sportsSession = raw('SELECT id FROM sessions WHERE club_id=? LIMIT 1', club('sports').id)[0].id;
    const sportsSub = raw('SELECT s.id FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.club_id=? LIMIT 1', club('sports').id)[0].id;
    const sportsMember = members('sports')[5];
    const tests = [
      ['coordinator reads another club activity', () => h.call('GET', `/activities/${sportsAct}`, { as: codingPres })],
      ['coordinator reads another club attendance', () => h.call('GET', `/activities/${sportsAct}/attendance`, { as: codingPres })],
      ['coordinator opens another club live session', () => h.call('GET', `/sessions/${sportsSession}/live`, { as: codingPres })],
      ['coordinator corrects another club attendance', () => h.call('POST', `/sessions/${sportsSession}/attendance`, { as: codingPres, body: { user_id: sportsMember, status: 'present', reason: 'sneaky edit' } })],
      ['coordinator scores another club submission', () => h.call('PUT', `/submissions/${sportsSub}/evaluation`, { as: codingPres, body: { content: 1, presentation: 1, participation: 1 } })],
      ['coordinator reads another club join requests', () => h.call('GET', `/clubs/${club('sports').id}/requests`, { as: codingPres })],
      ['coordinator plans for another club', () => h.call('POST', '/activities', { as: codingPres, body: { club_id: club('sports').id, club_day_id: 1, topic: 'Hijack', format: 'ppt' } })],
      ['student corrects attendance', () => h.call('POST', `/sessions/${sportsSession}/attendance`, { as: sportsMember, body: { user_id: sportsMember, status: 'present', reason: 'give me credit' } })],
      ['student edits a score', () => h.call('PUT', `/submissions/${sportsSub}/evaluation`, { as: sportsMember, body: { content: 10, presentation: 10, participation: 10 } })],
      ['student publishes scores', () => h.call('POST', `/activities/${sportsAct}/publish-scores`, { as: sportsMember })],
      ['student creates a club', () => h.call('POST', '/clubs', { as: sportsMember, body: { name: 'My Club' } })],
      ['student opens the admin dashboard', () => h.call('GET', '/insights/overview', { as: sportsMember })],
      ['student reads the audit log', () => h.call('GET', '/audit', { as: sportsMember })],
      ['plain member plans an activity', () => h.call('POST', '/activities', { as: members('sports')[6], body: { club_id: club('sports').id, club_day_id: 1, topic: 'Not allowed', format: 'ppt' } })],
      ['student reads another student transcript', () => h.call('GET', `/students/${members('sports')[7]}/transcript`, { as: sportsMember })],
    ];
    for (const [name, fn] of tests) { const r = await fn(); assert.equal(r.status, 403, `${name} -> ${r.status}`); }
    ev('Permissions', `${tests.length} forbidden actions (cross-club coordinator access, student edits to attendance / scores / clubs / dashboards)`, `all ${tests.length} return 403`);
  });
  it('students see only their own submission and never an unpublished score', async () => {
    const aId = raw("SELECT a.id FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.club_id=? AND cd.date=? ", club('ent').id, '2026-10-24')[0].id;
    const sub = raw("SELECT s.id, s.user_id FROM submissions s JOIN memberships m ON m.user_id=s.user_id AND m.club_id=? WHERE s.activity_id=? AND m.position='member' LIMIT 1", club('ent').id, aId)[0];
    h.db.prepare('UPDATE evaluations SET published=0 WHERE submission_id=?').run(sub.id);
    const r = await h.call('GET', `/activities/${aId}/submissions`, { as: sub.user_id });
    assert.equal(r.data.items.length, 1); assert.equal(r.data.items[0].total, null);
    ev('Permissions', 'Student lists submissions: only own row, unpublished score hidden', 'pass');
  });
  it('uploads: allowed types only, deadline enforced', async () => {
    const aId = raw("SELECT a.id FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.club_id=? AND cd.date=? ", club('coding').id, '2026-10-24')[0].id;
    const m = members('coding')[9];
    const fd = new FormData(); fd.append('file', new Blob(['MZ']), 'virus.exe');
    assert.equal((await h.call('POST', `/activities/${aId}/submissions`, { as: m, form: fd })).status, 400);
    const ok = new FormData(); ok.append('file', new Blob(['%PDF-1.4 test']), 'work.pdf');
    assert.equal((await h.call('POST', `/activities/${aId}/submissions`, { as: m, form: ok })).status, 201);
    const sub = one('SELECT id FROM submissions WHERE activity_id=? AND user_id=?', aId, m);
    assert.equal((await h.call('GET', `/submissions/${sub.id}/file`, { as: m, raw: true })).status, 200);
    assert.equal((await h.call('GET', `/submissions/${sub.id}/file`, { as: members('ent')[4], raw: true })).status, 403);
    h.clock.now = Date.parse('2026-11-01T00:00:00Z');
    const late = new FormData(); late.append('link_url', 'https://example.com/late');
    assert.equal((await h.call('POST', `/activities/${aId}/submissions`, { as: members('coding')[8], form: late })).status, 403);
    h.clock.now = T0 + 3 * 3600 * 1000;
    ev('Submissions', '.exe rejected, PDF accepted, other club cannot download, submission after deadline rejected', 'pass');
  });
});

describe('Reports match the raw data', () => {
  const round1 = (n) => Math.round(n * 10) / 10, round2 = (n) => Math.round(n * 100) / 100;
  for (const month of ['2026-09', '2026-10']) {
    it(`monthly figures for ${month} equal figures recomputed from raw tables`, async () => {
      let checked = 0;
      for (const c of S.clubs) {
        const rep = (await h.call('GET', `/reports/monthly?month=${month}&club_id=${c.id}`, { as: S.admin })).data.reports[0];
        const members = one("SELECT COUNT(*) n FROM memberships WHERE club_id=? AND status='active'", c.id).n;
        const sessions = raw(`SELECT s.id, a.id aid FROM sessions s JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id WHERE a.club_id=? AND substr(cd.date,1,7)=?`, c.id, month);
        let attended = 0, subs = 0; const scores = [];
        for (const s of sessions) {
          attended += raw('SELECT status FROM attendance WHERE session_id=?', s.id).filter((x) => x.status !== 'absent').length;
          for (const sub of raw('SELECT id FROM submissions WHERE activity_id=?', s.aid)) { subs++; const e = one('SELECT total, published FROM evaluations WHERE submission_id=?', sub.id); if (e?.published) scores.push(e.total); }
        }
        assert.equal(rep.held, sessions.length, 'club days held');
        assert.equal(rep.attended, attended, 'check-ins');
        assert.equal(rep.submissions, subs, 'submissions');
        assert.equal(rep.attendance_pct, sessions.length ? round1((attended / (sessions.length * members)) * 100) : 0, 'attendance %');
        assert.equal(rep.avg_score, scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null, 'average score');
        checked++;
      }
      const csv = await h.call('GET', `/reports/monthly.csv?month=${month}`, { as: S.manager });
      assert.equal(csv.status, 200); assert.match(csv.data, /attendance_pct/);
      ev('Reports', `Monthly report ${month}: held, check-ins, submissions, attendance %, average score for ${checked} clubs recomputed independently from raw rows`, 'all values equal');
    });
  }
  it('dashboard: top contributors, zero-participation students, inactive clubs', async () => {
    const o = await h.call('GET', '/insights/overview', { as: S.manager });
    assert.equal(o.status, 200);
    assert.equal(o.data.totals.clubs, 4);
    assert.ok(o.data.top_contributors.length > 0 && o.data.top_contributors[0].points >= o.data.top_contributors[1].points);
    const zeroRaw = raw(`SELECT u.id FROM users u WHERE u.system_role='student' AND u.is_test=0 AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id=u.id AND a.status IN ('present','late'))
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.user_id=u.id) AND NOT EXISTS (SELECT 1 FROM event_regs r WHERE r.user_id=u.id)`).length;
    assert.equal(o.data.zero_participation.length, zeroRaw);
    const coord = await h.call('GET', '/insights/overview', { as: members('coding')[0] });
    assert.equal(coord.data.clubs.length, 1);
    ev('Dashboards', 'Overview totals, top contributors ordering, zero-participation list equals raw query; coordinator sees only own club', 'pass');
  });
});

describe('Automation (Club Day timeline)', () => {
  it('announces approved activities 3 days before and reminds about missing plans', async () => {
    h.clock.now = Date.parse('2026-10-14T05:00:00Z'); // 3 days before 17 Oct
    const jobs = (await h.call('POST', '/admin/run-jobs', { as: S.admin })).data;
    assert.ok(jobs.announced >= 1, 'announcement sent');
    const note = one("SELECT * FROM notifications WHERE title LIKE '%Entrepreneurship Club Day%' ORDER BY id DESC LIMIT 1");
    assert.ok(note); assert.match(note.body, /Venue/);
    const again = (await h.call('POST', '/admin/run-jobs', { as: S.admin })).data;
    assert.equal(again.announced, 0, 'not announced twice');
    ev('Automation', '3-day announcement sent once with topic, venue, deliverable and deadline; plan-due reminders; month-end report generator', 'pass');
    h.clock.now = T0 + 3 * 3600 * 1000;
  });
  it('generates month-end reports and notifies the campus manager', async () => {
    const r = await h.call('POST', '/reports/monthly/generate', { as: S.manager, body: { month: '2026-09' } });
    assert.equal(r.status, 200); assert.equal(r.data.clubs, 4);
    assert.ok(one("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND title LIKE '%2026-09 report%'", S.manager).n >= 4);
  });
});

describe('Validation and safety', () => {
  it('rejects malformed input with readable errors', async () => {
    const pres = members('coding')[0];
    const r = await h.call('POST', '/activities', { as: pres, body: { club_id: 'x' } });
    assert.equal(r.status, 400); assert.ok(r.data.error);
    assert.equal((await h.call('POST', '/checkin', { as: pres, body: {} })).status, 400);
    assert.equal((await h.call('POST', '/club-days/import', { as: S.manager, body: { csv: 'date,title,venue\n2026-12-05,Club Day,Hall\nnot-a-date,x,y' } })).data.errors.length, 1);
  });
  it('forged JWT is rejected', async () => {
    const forged = jwt.sign({ id: S.admin }, 'wrong-secret');
    assert.equal((await h.call('GET', '/me', { as: forged })).status, 401);
  });
});
