import { Router } from 'express';
import { parse, z, iso, isUnique, conflict, bad, forbidden, notFound, HttpError, distanceM } from '../lib/util.js';
import { parseToken, tokenState, codeMatches, makeToken, codeFor, slotNow } from '../lib/tokens.js';
import { openSession, sessionAttendance } from '../lib/sessions.js';
import { announceActivity } from '../lib/jobs.js';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export default function dayRoutes(ctx) {
  const r = Router();
  const { db, access: acc, cfg } = ctx;
  const A = ctx.auth;
  const ROT = cfg.rotateSeconds;
  const coordIds = (clubId) => db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND position IN ('president','vice_president')").all(clubId).map((x) => x.user_id);

  // ---------- Check-in (registered first: it is the hot path) ----------
  const qSession = db.prepare('SELECT * FROM sessions WHERE id=?');
  const qOpenForUser = db.prepare(`SELECT s.* FROM sessions s WHERE s.status='open' AND s.closes_at>? AND (
      (s.kind='club_day' AND s.club_id IN (SELECT club_id FROM memberships WHERE user_id=? AND status='active'))
      OR (s.kind='event' AND s.event_id IN (SELECT event_id FROM event_regs WHERE user_id=?)))`);
  const qEligibleClub = db.prepare("SELECT 1 FROM memberships WHERE club_id=? AND user_id=? AND status='active'");
  const qEligibleEvent = db.prepare('SELECT 1 FROM event_regs WHERE event_id=? AND user_id=?');
  const qExisting = db.prepare('SELECT status, correction_reason FROM attendance WHERE session_id=? AND user_id=?');
  const qInsert = db.prepare('INSERT INTO attendance(session_id,user_id,status,method,checked_at,distance_m,flag) VALUES (?,?,?,?,?,?,?)');
  const qLabel = db.prepare(`SELECT COALESCE((SELECT c.name FROM clubs c WHERE c.id=?), (SELECT e.name FROM events e WHERE e.id=?)) label,
    COALESCE((SELECT a.topic FROM activities a WHERE a.id=?), '') topic`);

  // The hot path for 500 students in 5 minutes: 3-4 indexed point queries + 1 insert, no joins.
  r.post('/checkin', A, ctx.checkinLimiter, (req, res) => {
    const b = parse(z.object({ token: z.string().max(120).optional(), code: z.string().regex(/^\d{6}$/, 'The code has 6 digits').optional(),
      lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() })
      .refine((v) => v.token || v.code, { message: 'Provide the QR token or the 6-digit code' }), req.body);
    const u = req.user, nowMs = ctx.now(), nowIso = iso(nowMs);
    let session, method;
    if (b.token) {
      const p = parseToken(b.token);
      session = p && qSession.get(p.sid);
      if (!p || !session) throw bad('That QR code is not valid.');
      const st = tokenState(session, p, nowMs, ROT);
      if (st === 'forged') throw bad('That QR code is not valid.');
      if (st === 'expired') throw new HttpError(410, 'This QR code has expired. Scan the live code on the coordinator’s screen; screenshots do not work.');
      method = 'qr';
    } else {
      session = qOpenForUser.all(nowIso, u.id, u.id).find((s) => codeMatches(s, b.code, nowMs, ROT));
      if (!session) throw new HttpError(410, 'That code is wrong or has expired. Check the number on the coordinator’s screen.');
      method = 'code';
    }
    const eligible = session.kind === 'club_day' ? qEligibleClub.get(session.club_id, u.id) : qEligibleEvent.get(session.event_id, u.id);
    if (!eligible) throw forbidden(session.kind === 'club_day' ? 'Only members of this club can check in.' : 'You are not registered for this event.');
    if (session.status !== 'open' || session.closes_at <= nowIso) throw conflict('Check-in has closed for this session.');
    const ex = qExisting.get(session.id, u.id);
    if (ex) throw conflict(ex.correction_reason ? 'A coordinator already set your attendance for this session.' : 'You are already checked in.');
    let flag = null, dist = null;
    if (session.geo_mode !== 'off' && session.geo_lat != null) {
      if (b.lat == null || b.lng == null) {
        if (session.geo_mode === 'block') throw forbidden('Share your location to check in. It is only used to confirm you are on campus.');
        flag = 'Location not shared';
      } else {
        dist = distanceM(b.lat, b.lng, session.geo_lat, session.geo_lng);
        if (dist > session.geo_radius_m) {
          if (session.geo_mode === 'block') throw forbidden(`You appear to be ${dist} m from campus. Check in from the venue.`);
          flag = `Outside campus (${dist} m away)`;
        }
      }
    }
    const status = nowIso > session.late_after ? 'late' : 'present';
    if (status === 'late') flag = flag ? `Late; ${flag}` : 'Late';
    try { qInsert.run(session.id, u.id, status, method, nowIso, dist, flag); }
    catch (e) { if (isUnique(e)) throw conflict('You are already checked in.'); throw e; }
    const lab = qLabel.get(session.club_id, session.event_id, session.activity_id);
    res.status(201).json({ ok: true, status, flag, session_id: session.id, label: lab.label, topic: lab.topic });
  });


  // ---------- Club Day calendar ----------
  r.get('/club-days', A, (req, res) => {
    const u = req.user;
    const campusId = acc.isSuperAdmin(u) && req.query.campus_id ? Number(req.query.campus_id) : (u.campus_id || null);

    let daysSql = 'SELECT cd.*, ca.name campus_name FROM club_days cd JOIN campuses ca ON ca.id=cd.campus_id';
    const daysParams = [];
    if (campusId) {
      daysSql += ' WHERE cd.campus_id=?';
      daysParams.push(campusId);
    }
    daysSql += ' ORDER BY cd.date';
    const days = db.prepare(daysSql).all(...daysParams);

    let actsSql = `SELECT a.id,a.club_id,a.club_day_id,a.topic,a.format,a.status,c.name club_name,c.advisor_id,c.campus_id FROM activities a
      JOIN clubs c ON c.id=a.club_id JOIN club_days cd ON cd.id=a.club_day_id`;
    const actsParams = [];
    if (campusId) {
      actsSql += ' WHERE cd.campus_id=?';
      actsParams.push(campusId);
    }
    actsSql += ' ORDER BY c.name';
    const acts = db.prepare(actsSql).all(...actsParams);

    const memberOf = new Map(db.prepare("SELECT club_id, position FROM memberships WHERE user_id=? AND status='active'").all(u.id).map((m) => [m.club_id, m.position]));
    const visible = acts.filter((a) => {
      if (acc.isSuperAdmin(u) || u.system_role === 'campus_admin' || u.system_role === 'campus_manager') return true;
      if (a.advisor_id === u.id || db.prepare('SELECT 1 FROM faculty_advisor_assignments WHERE club_id=? AND user_id=?').get(a.club_id, u.id)) return true;
      const pos = memberOf.get(a.club_id);
      if (!pos) return false;
      return a.status === 'approved' || pos === 'president' || pos === 'vice_president';
    });

    // Clubs this user can plan activities for:
    // - Advisors can plan for their assigned clubs
    // - Presidents/VPs can plan for their led clubs
    // - Campus Admins & Super Admins can plan for campus clubs
    let managed = [];
    if (acc.isSuperAdmin(u)) {
      managed = db.prepare("SELECT c.id, c.name FROM clubs c WHERE c.status='approved' AND c.is_test=0" + (campusId ? ' AND c.campus_id=?' : '') + ' ORDER BY c.name').all(...(campusId ? [campusId] : []));
    } else if (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') {
      managed = db.prepare("SELECT c.id, c.name FROM clubs c WHERE c.campus_id=? AND c.status='approved' AND c.is_test=0 ORDER BY c.name").all(u.campus_id);
    } else if (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') {
      managed = db.prepare(`SELECT DISTINCT c.id, c.name FROM clubs c
        LEFT JOIN faculty_advisor_assignments fa ON fa.club_id=c.id
        WHERE c.status='approved' AND c.is_test=0 AND (c.advisor_id=? OR fa.user_id=?) ORDER BY c.name`).all(u.id, u.id);
    } else {
      managed = db.prepare(`SELECT c.id, c.name FROM clubs c
        JOIN memberships m ON m.club_id=c.id
        WHERE m.user_id=? AND m.status='active' AND m.position IN ('president','vice_president') AND c.status='approved' AND c.is_test=0 ORDER BY c.name`).all(u.id);
    }

    res.json({
      days: days.map((d) => ({
        ...d,
        plan_due: addDays(d.date, -7),
        activities: visible.filter((a) => a.club_day_id === d.id).map(({ advisor_id, ...a }) => a),
      })),
      managed_clubs: managed,
    });
  });

  // ---- Add date one by one (Campus Admin or Super Admin) ----
  r.post('/club-days', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const b = parse(z.object({
      date: z.string().regex(dateRe),
      title: z.string().max(100).optional(),
      venue: z.string().max(100).optional(),
      campus_id: z.number().int().optional(),
    }), req.body);
    const campusId = acc.isSuperAdmin(req.user) ? (b.campus_id ?? req.user.campus_id) : req.user.campus_id;
    if (!campusId) throw bad('Campus ID is required.');
    try {
      const info = db.prepare('INSERT INTO club_days(campus_id,date,title,venue) VALUES (?,?,?,?)')
        .run(campusId, b.date, b.title ?? 'Club Day', b.venue ?? null);
      ctx.audit(req.user.id, 'clubday.create', 'club_day', info.lastInsertRowid, { neu: { date: b.date, title: b.title, campus_id: campusId } });
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) {
      if (isUnique(e)) throw conflict('That date is already on the calendar.');
      throw e;
    }
  });

  // ---- Import academic calendar (CSV) (Campus Admin or Super Admin) ----
  r.post('/club-days/import', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const b = parse(z.object({
      csv: z.string().min(8).max(50000),
      campus_id: z.number().int().optional(),
    }), req.body);
    const campusId = acc.isSuperAdmin(req.user) ? (b.campus_id ?? req.user.campus_id) : req.user.campus_id;
    if (!campusId) throw bad('Campus ID is required.');

    const ins = db.prepare('INSERT OR IGNORE INTO club_days(campus_id,date,title,venue) VALUES (?,?,?,?)');
    let created = 0, skipped = 0; const errors = [];
    db.transaction(() => {
      b.csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
        const [date, title, venue] = line.split(',').map((x) => x?.trim());
        if (i === 0 && !dateRe.test(date)) return; // header row
        if (!dateRe.test(date) || Number.isNaN(Date.parse(date))) {
          errors.push(`Line ${i + 1}: "${date}" is not a valid YYYY-MM-DD date`);
          return;
        }
        if (ins.run(campusId, date, title || 'Club Day', venue || null).changes) created++;
        else skipped++;
      });
    })();
    ctx.audit(req.user.id, 'clubday.import', 'club_day', '-', { neu: { created, skipped, campus_id: campusId } });
    res.json({ created, skipped, errors });
  });

  // ---- Delete calendar date (Campus Admin or Super Admin) ----
  r.delete('/club-days/:id', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const d = db.prepare('SELECT * FROM club_days WHERE id=?').get(req.params.id);
    if (!d) throw notFound('Date not found');
    if (!acc.isSuperAdmin(req.user) && d.campus_id !== req.user.campus_id) throw forbidden('Access denied.');

    const actCount = db.prepare('SELECT COUNT(*) n FROM activities WHERE club_day_id=?').get(d.id).n;
    if (actCount > 0) throw conflict(`Cannot delete this date: ${actCount} club activities are already planned on it.`);

    db.prepare('DELETE FROM club_days WHERE id=?').run(d.id);
    ctx.audit(req.user.id, 'clubday.delete', 'club_day', d.id, { old: { date: d.date, title: d.title } });
    res.json({ ok: true });
  });

  // ---------- Activity plans ----------
  const planBody = z.object({
    club_id: z.number().int(), club_day_id: z.number().int(), topic: z.string().min(3).max(200),
    format: z.enum(['ppt', 'assignment', 'on_the_spot']), deliverable: z.string().max(300).optional(),
    venue: z.string().max(120).optional(), submission_deadline: z.string().max(40).optional(),
  });

  r.post('/activities', A, (req, res) => {
    const b = parse(planBody, req.body);
    const c = acc.club(b.club_id);
    const isAdv = acc.isAdvisor(req.user, c);
    const canPlan = acc.canRun(req.user, c) || isAdv || acc.isCampusAdmin(req.user, c);
    acc.require(canPlan, 'Only the club President, Vice President, or Faculty Advisor can plan activities.');
    if (c.status !== 'approved') throw conflict('This club is not approved yet.');
    const day = db.prepare('SELECT * FROM club_days WHERE id=? AND campus_id=?').get(b.club_day_id, c.campus_id);
    if (!day) throw notFound('Club Day not found');
    let deadline = null;
    if (b.format !== 'on_the_spot') {
      deadline = b.submission_deadline ? new Date(b.submission_deadline) : new Date(`${addDays(day.date, 2)}T18:29:00.000Z`); // 23:59 IST, 48 h after
      if (Number.isNaN(deadline.getTime())) throw bad('submission_deadline is not a valid date.');
      deadline = deadline.toISOString();
    }
    const ex = db.prepare('SELECT * FROM activities WHERE club_id=? AND club_day_id=?').get(c.id, day.id);
    const t = iso(ctx.now());
    const initialStatus = isAdv ? 'approved' : 'draft';

    if (ex) {
      if (!['draft', 'changes_requested'].includes(ex.status) && !acc.isAdmin(req.user) && !isAdv) throw conflict('This plan is already submitted or approved and can no longer be edited.');
      db.prepare("UPDATE activities SET topic=?,format=?,deliverable=?,venue=?,submission_deadline=?,status=?,updated_at=? WHERE id=?").run(b.topic, b.format, b.deliverable ?? null, b.venue ?? null, deadline, initialStatus, t, ex.id);
      return res.json({ id: ex.id, status: initialStatus });
    }
    const info = db.prepare("INSERT INTO activities(club_id,club_day_id,topic,format,deliverable,venue,submission_deadline,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(c.id, day.id, b.topic, b.format, b.deliverable ?? null, b.venue ?? null, deadline, initialStatus, req.user.id, t);
    res.status(201).json({ id: info.lastInsertRowid, status: initialStatus });
  });

  const loadActivity = (id) => {
    const a = db.prepare(`SELECT a.*, cd.date, cd.title day_title, cd.venue day_venue FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.id=?`).get(id);
    if (!a) throw notFound('Activity not found');
    return a;
  };

  r.post('/activities/:id/submit-plan', A, (req, res) => {
    const a = loadActivity(req.params.id), c = acc.club(a.club_id);
    acc.require(acc.canRun(req.user, c));
    if (!['draft', 'changes_requested'].includes(a.status)) throw conflict('This plan was already sent to the advisor.');
    if (!c.advisor_id) throw conflict('This club has no faculty advisor yet. Ask the admin to assign one.');
    db.prepare("UPDATE activities SET status='pending', updated_at=? WHERE id=?").run(iso(ctx.now()), a.id);
    ctx.notify([c.advisor_id], `Plan to approve: ${c.name}, ${a.date}`, a.topic, `/activities/${a.id}`);
    res.json({ status: 'pending' });
  });

  r.post('/activities/:id/review', A, (req, res) => {
    const a = loadActivity(req.params.id), c = acc.club(a.club_id);
    acc.require(acc.canReviewPlan(req.user, c), 'Only the club’s faculty advisor can approve plans.');
    const b = parse(z.object({ decision: z.enum(['approve', 'changes']), comment: z.string().max(500).optional() }), req.body);
    if (a.status !== 'pending') throw conflict('This plan is not waiting for review.');
    if (b.decision === 'changes' && !b.comment?.trim()) throw bad('Say what needs to change so the coordinators can fix it.');
    const status = b.decision === 'approve' ? 'approved' : 'changes_requested';
    db.prepare('UPDATE activities SET status=?, advisor_comment=?, updated_at=? WHERE id=?').run(status, b.comment ?? null, iso(ctx.now()), a.id);
    ctx.audit(req.user.id, `plan.${status}`, 'activity', a.id, { reason: b.comment });
    ctx.notify(coordIds(c.id), status === 'approved' ? `Plan approved: ${a.topic}` : `Changes requested: ${a.topic}`, b.comment || null, `/activities/${a.id}`);
    if (status === 'approved' && a.date <= addDays(iso(ctx.now()).slice(0, 10), 3)) announceActivity(ctx, a.id);
    res.json({ status });
  });

  r.get('/activities/:id', A, (req, res) => {
    const u = req.user, a = loadActivity(req.params.id), c = acc.club(a.club_id);
    const member = acc.isMember(u, c);
    const visible = acc.canViewClubData(u, c) || (member && a.status === 'approved');
    if (!visible) throw forbidden();
    const session = db.prepare('SELECT id,status,opened_at,closes_at,late_after,geo_mode FROM sessions WHERE activity_id=?').get(a.id) || null;
    const nowIso = iso(ctx.now());
    const myAtt = session ? db.prepare('SELECT status,checked_at,flag FROM attendance WHERE session_id=? AND user_id=?').get(session.id, u.id) || null : null;
    const mySub = db.prepare('SELECT id,type,original_name,link_url,note,submitted_at FROM submissions WHERE activity_id=? AND user_id=?').get(a.id, u.id) || null;
    const myEval = mySub ? db.prepare('SELECT content,presentation,participation,total,comment FROM evaluations WHERE submission_id=? AND published=1').get(mySub.id) || null : null;
    const deadlinePassed = a.submission_deadline ? a.submission_deadline < nowIso : false;
    res.json({
      activity: { ...a, club_name: c.name, advisor_id: c.advisor_id }, session, my_attendance: myAtt, my_submission: mySub, my_evaluation: myEval,
      session_open: !!session && session.status === 'open' && session.closes_at > nowIso, deadline_passed: deadlinePassed,
      can: {
        edit_plan: (acc.canRun(u, c) && ['draft', 'changes_requested'].includes(a.status)) || (acc.isAdmin(u) && a.status !== 'approved'),
        submit_plan: acc.canRun(u, c) && ['draft', 'changes_requested'].includes(a.status),
        review: acc.canReviewPlan(u, c) && a.status === 'pending', run: acc.canRun(u, c) && a.status === 'approved',
        evaluate: acc.canEvaluate(u, c), view_all: acc.canViewClubData(u, c),
        submit_work: member && a.status === 'approved' && a.format !== 'on_the_spot' && !deadlinePassed,
        check_in: member && a.status === 'approved' && !!session,
      },
    });
  });

  // ---------- Check-in sessions ----------
  r.post('/activities/:id/session', A, (req, res) => {
    const a = loadActivity(req.params.id), c = acc.club(a.club_id);
    acc.require(acc.canRun(req.user, c), 'Only the club’s President or Vice President can run check-in.');
    if (a.status !== 'approved') throw conflict('The advisor must approve the plan before check-in can open.');
    const b = parse(z.object({ window_minutes: z.number().int().optional(), late_after_minutes: z.number().int().optional(), geo_mode: z.enum(['off', 'flag', 'block']).optional() }), req.body);
    const { session, fresh } = openSession(ctx, { activity: a, user: req.user, windowMin: b.window_minutes, lateMin: b.late_after_minutes, geoMode: b.geo_mode });
    if (fresh) {
      const ids = db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND user_id!=?").all(c.id, req.user.id).map((x) => x.user_id);
      ctx.notify(ids, `Check-in is open: ${c.name}`, `Scan the QR code on the coordinator’s screen or enter the 6-digit code. Topic: ${a.topic}`, '/checkin', { email: false });
    }
    ctx.audit(req.user.id, 'session.open', 'session', session.id);
    res.status(201).json({ id: session.id });
  });

  const canSeeSession = (u, s) => {
    if (s.kind === 'club_day') return acc.canViewClubData(u, acc.club(s.club_id));
    const ev = db.prepare('SELECT * FROM events WHERE id=?').get(s.event_id);
    return acc.isAdmin(u) || (u.system_role === 'campus_manager' && (ev.campus_id == null || ev.campus_id === u.campus_id));
  };
  const loadSession = (id) => { const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(id); if (!s) throw notFound('Session not found'); return s; };

  r.get('/sessions/:id/live', A, (req, res) => {
    const s = loadSession(req.params.id);
    acc.require(canSeeSession(req.user, s));
    const nowMs = ctx.now(), nowIso = iso(nowMs);
    const open = s.status === 'open' && s.closes_at > nowIso;
    const slot = slotNow(nowMs, ROT);
    const roster = sessionAttendance(db, s);
    const title = s.kind === 'club_day'
      ? db.prepare('SELECT a.topic, c.name club_name FROM activities a JOIN clubs c ON c.id=a.club_id WHERE a.id=?').get(s.activity_id)
      : db.prepare('SELECT name topic, NULL club_name FROM events WHERE id=?').get(s.event_id);
    res.json({
      session: { id: s.id, kind: s.kind, status: open ? 'open' : 'closed', opened_at: s.opened_at, closes_at: s.closes_at, late_after: s.late_after, geo_mode: s.geo_mode, activity_id: s.activity_id, event_id: s.event_id, ...title },
      token: open ? makeToken(s, slot) : null, code: open ? codeFor(s.secret, s.id, slot) : null,
      expires_in: Math.ceil(ROT - ((nowMs / 1000) % ROT)), rotate_seconds: ROT, server_time: nowIso,
      counts: { present: roster.filter((p) => p.status === 'present').length, late: roster.filter((p) => p.status === 'late').length, expected: roster.length },
      roster,
    });
  });

  r.post('/sessions/:id/close', A, (req, res) => {
    const s = loadSession(req.params.id);
    acc.require(canSeeSession(req.user, s) && (s.kind === 'event' || acc.canRun(req.user, acc.club(s.club_id)) || acc.isAdvisor(req.user, acc.club(s.club_id))));
    db.prepare("UPDATE sessions SET status='closed' WHERE id=?").run(s.id);
    ctx.audit(req.user.id, 'session.close', 'session', s.id);
    res.json({ ok: true });
  });

  // Coordinator correction: reason is mandatory and every change is audited.
  r.post('/sessions/:id/attendance', A, (req, res) => {
    const s = loadSession(req.params.id);
    const ok = s.kind === 'club_day' ? (() => { const c = acc.club(s.club_id); return acc.canRun(req.user, c) || acc.isAdvisor(req.user, c); })() : canSeeSession(req.user, s);
    acc.require(ok, 'Only the club’s coordinators or advisor can correct attendance.');
    const b = parse(z.object({ user_id: z.number().int(), status: z.enum(['present', 'late', 'absent']), reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(300) }), req.body);
    const onRoster = sessionAttendance(db, s).some((p) => p.user_id === b.user_id);
    if (!onRoster) throw bad('That student is not on this session’s roster.');
    const old = db.prepare('SELECT status FROM attendance WHERE session_id=? AND user_id=?').get(s.id, b.user_id);
    const t = iso(ctx.now());
    if (old) db.prepare('UPDATE attendance SET status=?, corrected_by=?, correction_reason=? WHERE session_id=? AND user_id=?').run(b.status, req.user.id, b.reason, s.id, b.user_id);
    else db.prepare("INSERT INTO attendance(session_id,user_id,status,method,checked_at,corrected_by,correction_reason) VALUES (?,?,?,'manual',?,?,?)").run(s.id, b.user_id, b.status, t, req.user.id, b.reason);
    ctx.audit(req.user.id, 'attendance.correct', 'attendance', `${s.id}:${b.user_id}`, { old: old?.status ?? 'absent', neu: b.status, reason: b.reason });
    ctx.notify([b.user_id], 'Your attendance was updated', `Marked ${b.status}. Reason: ${b.reason}`, '/', { email: false });
    res.json({ ok: true });
  });

  r.get('/activities/:id/attendance', A, (req, res) => {
    const a = loadActivity(req.params.id), c = acc.club(a.club_id);
    acc.require(acc.canViewClubData(req.user, c));
    const s = db.prepare('SELECT * FROM sessions WHERE activity_id=?').get(a.id);
    res.json({ session: s ? { id: s.id, status: s.status } : null, roster: s ? sessionAttendance(db, s) : [] });
  });
  return r;
}
