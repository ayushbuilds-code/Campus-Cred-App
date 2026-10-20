import { Router } from 'express';
import crypto from 'node:crypto';
import { parse, z, iso, isUnique, conflict, bad, forbidden, notFound } from '../lib/util.js';
import { openSession } from '../lib/sessions.js';
import { issueCertificate } from '../lib/certs.js';

const POSITION_TITLE = { 1: 'Winner', 2: 'First runner-up', 3: 'Second runner-up' };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export default function eventRoutes(ctx) {
  const r = Router();
  const { db, access: acc } = ctx;
  const A = ctx.auth;
  const isSuper = (u) => u.system_role === 'super_admin' || u.system_role === 'admin';
  const isCampus = (u, ev) => (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') && (ev ? (ev.campus_id == null || ev.campus_id === u.campus_id) : true);
  const isManager = (u, ev) => isSuper(u) || isCampus(u, ev) || (ev?.club_id ? !!db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND club_id=? AND status='active' AND position IN ('president','vice_president')").get(u.id, ev.club_id) : false);
  const loadEvent = (id) => { const e = db.prepare('SELECT * FROM events WHERE id=?').get(id); if (!e) throw notFound('Event not found'); return e; };
  const visibleTo = (u, ev) => isSuper(u) || ev.campus_id == null || ev.campus_id === u.campus_id;
  const regCount = (id) => db.prepare('SELECT COUNT(*) n FROM event_regs WHERE event_id=?').get(id).n;
  const teamSize = (id) => db.prepare('SELECT COUNT(*) n FROM event_regs WHERE team_id=?').get(id).n;

  r.get('/events', A, (req, res) => {
    const u = req.user;
    const filterCampusId = req.query.campus_id ? Number(req.query.campus_id) : null;
    let sql = `SELECT e.*,
      (SELECT name FROM campuses ca WHERE ca.id=e.campus_id) campus_name,
      (SELECT name FROM clubs cl WHERE cl.id=e.club_id) club_name,
      (SELECT COUNT(*) FROM event_regs r WHERE r.event_id=e.id) registered,
      (SELECT COUNT(*) FROM teams t WHERE t.event_id=e.id) teams,
      (SELECT team_id FROM event_regs r WHERE r.event_id=e.id AND r.user_id=?) my_team_id,
      EXISTS (SELECT 1 FROM event_regs r WHERE r.event_id=e.id AND r.user_id=?) registered_me
      FROM events e WHERE e.is_test=0`;
    const params = [u.id, u.id];

    if (isSuper(u)) {
      if (filterCampusId) {
        sql += ` AND (e.campus_id IS NULL OR e.campus_id=?)`;
        params.push(filterCampusId);
      }
    } else {
      sql += ` AND (e.campus_id IS NULL OR e.campus_id=?)`;
      params.push(u.campus_id);
    }
    sql += ` ORDER BY e.starts_at DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json({ items: rows });
  });

  const eventBody = z.object({
    name: z.string().min(3).max(120), kind: z.string().max(40).optional(), description: z.string().max(1500).optional(), venue: z.string().max(120).optional(),
    starts_at: z.string().min(8), ends_at: z.string().optional(), registration_deadline: z.string().optional(),
    capacity: z.number().int().min(1).max(5000).default(200), team_size_min: z.number().int().min(1).max(20).default(1), team_size_max: z.number().int().min(1).max(20).default(1),
    inter_college: z.boolean().default(false), inter_campus: z.boolean().default(false),
    campus_id: z.number().int().nullable().optional(),
    club_id: z.number().int().nullable().optional(),
  }).refine((v) => v.team_size_max >= v.team_size_min, { message: 'Maximum team size must be at least the minimum' });
  const dt = (s, label) => { const d = new Date(s); if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid date.`); return d.toISOString(); };

  r.post('/events', A, (req, res) => {
    acc.require(acc.canCreateEvent(req.user), 'Only admins, campus managers, or club coordinators can organize events.');
    const b = parse(eventBody, req.body);
    let campusId = null;
    if (isSuper(req.user)) {
      campusId = b.inter_campus ? null : (b.campus_id !== undefined ? b.campus_id : null);
    } else if (isCampus(req.user)) {
      campusId = b.inter_campus ? null : req.user.campus_id;
    } else {
      campusId = req.user.campus_id;
    }

    const info = db.prepare(`INSERT INTO events(campus_id,club_id,name,kind,description,venue,starts_at,ends_at,registration_deadline,capacity,team_size_min,team_size_max,inter_college,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'open', ?,?)`).run(campusId, b.club_id ?? null, b.name, b.kind ?? null, b.description ?? null, b.venue ?? null,
      dt(b.starts_at, 'starts_at'), b.ends_at ? dt(b.ends_at, 'ends_at') : null, b.registration_deadline ? dt(b.registration_deadline, 'registration_deadline') : dt(b.starts_at, 'starts_at'),
      b.capacity, b.team_size_min, b.team_size_max, b.inter_college ? 1 : 0, req.user.id, iso(ctx.now()));
    ctx.audit(req.user.id, 'event.create', 'event', info.lastInsertRowid, { neu: { name: b.name, campus_id: campusId } });
    const base = "SELECT id FROM users WHERE system_role='student' AND is_test=0";
    const students = (campusId == null ? db.prepare(base).all() : db.prepare(`${base} AND campus_id=?`).all(campusId)).map((x) => x.id);
    ctx.notify(students, `New event: ${b.name}`, `${b.venue || ''} Registration is open.`, `/events/${info.lastInsertRowid}`, { email: false });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  r.get('/events/:id', A, (req, res) => {
    const u = req.user, ev = loadEvent(req.params.id);
    if (!visibleTo(u, ev)) throw forbidden();
    const teams = db.prepare(`SELECT t.id,t.name,t.leader_id,t.invite_code FROM teams t WHERE t.event_id=? ORDER BY t.name`).all(ev.id).map((t) => {
      const mem = db.prepare('SELECT u.id user_id,u.name,r.result_position FROM event_regs r JOIN users u ON u.id=r.user_id WHERE r.team_id=? ORDER BY u.name').all(t.id);
      const mine = mem.some((m) => m.user_id === u.id);
      return { id: t.id, name: t.name, leader_id: t.leader_id, size: mem.length, members: mem, position: mem[0]?.result_position ?? null, invite_code: mine || isManager(u, ev) ? t.invite_code : undefined };
    });
    const mine = db.prepare('SELECT * FROM event_regs WHERE event_id=? AND user_id=?').get(ev.id, u.id) || null;
    const participants = db.prepare(`SELECT r.user_id, u.name, u.student_code, r.team_id, t.name team_name, r.result_position, r.registered_at
      FROM event_regs r JOIN users u ON u.id=r.user_id LEFT JOIN teams t ON t.id=r.team_id
      WHERE r.event_id=? ORDER BY r.registered_at`).all(ev.id);
    const nowIso = iso(ctx.now());
    const session = db.prepare('SELECT id,status,closes_at FROM sessions WHERE event_id=?').get(ev.id) || null;
    res.json({
      event: { ...ev, registered: regCount(ev.id) }, my_registration: mine, teams, participants, session,
      my_attendance: session ? db.prepare('SELECT status FROM attendance WHERE session_id=? AND user_id=?').get(session.id, u.id) || null : null,
      registration_open: ev.status === 'open' && (!ev.registration_deadline || ev.registration_deadline >= nowIso),
      can: { manage: isManager(u, ev) },
    });
  });

  // registration (the whole check + insert runs in one transaction: no duplicates, no overbooking)
  const registerTx = db.transaction((ev, userId, teamId) => {
    const nowIso = iso(ctx.now());
    if (ev.status !== 'open' || (ev.registration_deadline && ev.registration_deadline < nowIso)) throw conflict('Registration for this event is closed.');
    const ex = db.prepare('SELECT * FROM event_regs WHERE event_id=? AND user_id=?').get(ev.id, userId);
    if (ex && ex.team_id && teamId) throw conflict('You are already in a team for this event. Leave it first.');
    if (ex && !teamId) throw conflict('You are already registered for this event.');
    if (!ex && regCount(ev.id) >= ev.capacity) throw conflict('This event is full.');
    if (teamId && teamSize(teamId) >= ev.team_size_max) throw conflict(`This team is full (maximum ${ev.team_size_max} members).`);
    if (ex) db.prepare('UPDATE event_regs SET team_id=? WHERE id=?').run(teamId, ex.id);
    else {
      db.prepare('INSERT INTO event_regs(event_id,user_id,team_id,registered_at) VALUES (?,?,?,?)').run(ev.id, userId, teamId ?? null, nowIso);
      if (ev.inter_college) db.prepare('INSERT OR IGNORE INTO duty_leaves(event_id,user_id,created_at) VALUES (?,?,?)').run(ev.id, userId, nowIso);
    }
  });
  const guard = (fn) => { try { return fn(); } catch (e) { if (isUnique(e)) throw conflict('That entry already exists (you may have double-tapped).'); throw e; } };

  r.post('/events/:id/register', A, ctx.roles('student'), (req, res) => {
    const ev = loadEvent(req.params.id);
    if (!visibleTo(req.user, ev)) throw forbidden();
    if (ev.team_size_min > 1) throw conflict(`This is a team event (${ev.team_size_min}-${ev.team_size_max} members). Create a team or join one with an invite code.`);
    guard(() => registerTx(ev, req.user.id, null));
    res.status(201).json({ ok: true, duty_leave: !!ev.inter_college });
  });

  r.post('/events/:id/teams', A, ctx.roles('student'), (req, res) => {
    const ev = loadEvent(req.params.id);
    if (!visibleTo(req.user, ev)) throw forbidden();
    if (ev.team_size_max < 2) throw conflict('This is an individual event. Register without a team.');
    const { name } = parse(z.object({ name: z.string().trim().min(2).max(40) }), req.body);
    const out = guard(() => db.transaction(() => {
      const code = inviteCode();
      const info = db.prepare('INSERT INTO teams(event_id,name,invite_code,leader_id,created_at) VALUES (?,?,?,?,?)').run(ev.id, name, code, req.user.id, iso(ctx.now()));
      registerTx(ev, req.user.id, info.lastInsertRowid);
      return { id: info.lastInsertRowid, invite_code: code };
    })());
    res.status(201).json(out);
  });

  r.post('/events/:id/teams/join', A, ctx.roles('student'), (req, res) => {
    const ev = loadEvent(req.params.id);
    if (!visibleTo(req.user, ev)) throw forbidden();
    const { invite_code } = parse(z.object({ invite_code: z.string().trim().min(4).max(12) }), req.body);
    const team = db.prepare('SELECT * FROM teams WHERE event_id=? AND invite_code=?').get(ev.id, invite_code.toUpperCase());
    if (!team) throw notFound('That invite code does not match any team for this event.');
    guard(() => registerTx(ev, req.user.id, team.id));
    ctx.notify([team.leader_id], `${req.user.name} joined your team`, team.name, `/events/${ev.id}`, { email: false });
    res.json({ ok: true, team: team.name });
  });

  r.post('/events/:id/teams/leave', A, ctx.roles('student'), (req, res) => {
    const ev = loadEvent(req.params.id);
    if (ev.status !== 'open') throw conflict('Teams are locked for this event.');
    db.transaction(() => {
      const reg = db.prepare('SELECT * FROM event_regs WHERE event_id=? AND user_id=?').get(ev.id, req.user.id);
      if (!reg?.team_id) throw conflict('You are not in a team.');
      db.prepare('UPDATE event_regs SET team_id=NULL WHERE id=?').run(reg.id);
      const team = db.prepare('SELECT * FROM teams WHERE id=?').get(reg.team_id);
      const rest = db.prepare('SELECT user_id FROM event_regs WHERE team_id=? ORDER BY registered_at').all(team.id);
      if (!rest.length) db.prepare('DELETE FROM teams WHERE id=?').run(team.id);
      else if (team.leader_id === req.user.id) db.prepare('UPDATE teams SET leader_id=? WHERE id=?').run(rest[0].user_id, team.id);
      if (ev.team_size_min > 1) { // team events cannot have solo registrations left over
        db.prepare('DELETE FROM duty_leaves WHERE event_id=? AND user_id=? AND status=\'pending\'').run(ev.id, req.user.id);
        db.prepare('DELETE FROM event_regs WHERE id=?').run(reg.id);
      }
    })();
    res.json({ ok: true });
  });

  r.get('/events/:id/registrations', A, (req, res) => {
    const ev = loadEvent(req.params.id);
    acc.require(isManager(req.user, ev));
    res.json({ items: db.prepare(`SELECT r.user_id,u.name,u.student_code,t.name team,r.result_position,r.registered_at FROM event_regs r JOIN users u ON u.id=r.user_id LEFT JOIN teams t ON t.id=r.team_id
      WHERE r.event_id=? ORDER BY r.registered_at`).all(ev.id) });
  });

  r.post('/events/:id/session', A, (req, res) => {
    const ev = loadEvent(req.params.id);
    acc.require(isManager(req.user, ev), 'Only the admin or campus manager can run event check-in.');
    const { session } = openSession(ctx, { event: ev, user: req.user });
    res.status(201).json({ id: session.id });
  });

  // results: positions per team (or per person for individual events)
  r.post('/events/:id/results', A, async (req, res) => {
    const ev = loadEvent(req.params.id);
    acc.require(isManager(req.user, ev), 'Only the admin or campus manager can enter results.');
    const b = parse(z.object({ results: z.array(z.object({ team_id: z.number().int().optional(), user_id: z.number().int().optional(), position: z.number().int().min(1).max(50), note: z.string().max(200).optional() })
      .refine((v) => v.team_id || v.user_id, { message: 'Each result needs a team_id or user_id' })).min(1).max(100) }), req.body);
    const winners = [];
    db.transaction(() => {
      db.prepare('UPDATE event_regs SET result_position=NULL, result_note=NULL WHERE event_id=?').run(ev.id);
      for (const x of b.results) {
        const info = x.team_id
          ? db.prepare('UPDATE event_regs SET result_position=?, result_note=? WHERE event_id=? AND team_id=?').run(x.position, x.note ?? null, ev.id, x.team_id)
          : db.prepare('UPDATE event_regs SET result_position=?, result_note=? WHERE event_id=? AND user_id=?').run(x.position, x.note ?? null, ev.id, x.user_id);
        if (!info.changes) throw bad('A result refers to a team or student that is not registered for this event.');
      }
      db.prepare("UPDATE events SET status='completed' WHERE id=?").run(ev.id);
    })();
    ctx.audit(req.user.id, 'event.results', 'event', ev.id, { neu: b.results });
    const placed = db.prepare('SELECT user_id, result_position p FROM event_regs WHERE event_id=? AND result_position IS NOT NULL').all(ev.id);
    let issued = 0;
    for (const w of placed.filter((x) => x.p <= 3)) {
      const { created } = await issueCertificate(ctx, { userId: w.user_id, eventId: ev.id, kind: 'achievement', refKey: `event:${ev.id}:pos`, issuedBy: req.user.id,
        title: `${POSITION_TITLE[w.p]}, ${ev.name}`, detail: `Awarded position ${w.p} at ${ev.name}.` });
      if (created) issued++;
    }
    const sess = db.prepare('SELECT id FROM sessions WHERE event_id=?').get(ev.id);
    if (sess) {
      const attendees = db.prepare("SELECT user_id FROM attendance WHERE session_id=? AND status IN ('present','late')").all(sess.id);
      for (const a of attendees) {
        const { created } = await issueCertificate(ctx, { userId: a.user_id, eventId: ev.id, kind: 'participation', refKey: `event:${ev.id}`, issuedBy: req.user.id,
          title: `Participation, ${ev.name}`, detail: `For taking part in ${ev.name}.` });
        if (created) issued++;
      }
    }
    ctx.notify(placed.map((x) => x.user_id), `Results are out: ${ev.name}`, 'Open the event to see the standings.', `/events/${ev.id}`);
    res.json({ ok: true, certificates_issued: issued });
  });

  // ---------- Duty leave (stretch) ----------
  r.get('/duty-leaves', A, (req, res) => {
    const u = req.user;
    const base = `SELECT d.*, e.name event_name, e.starts_at, u.name student, u.student_code FROM duty_leaves d JOIN events e ON e.id=d.event_id JOIN users u ON u.id=d.user_id`;
    const rows = u.system_role === 'student' ? db.prepare(`${base} WHERE d.user_id=? ORDER BY d.id DESC`).all(u.id)
      : isSuper(u) ? db.prepare(`${base} ORDER BY d.status='pending' DESC, d.id DESC LIMIT 200`).all()
        : isCampus(u) ? db.prepare(`${base} WHERE u.campus_id=? ORDER BY d.status='pending' DESC, d.id DESC LIMIT 200`).all(u.campus_id) : [];
    res.json({ items: rows });
  });
  r.post('/duty-leaves/:id/decision', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const d = db.prepare('SELECT d.*, u.campus_id FROM duty_leaves d JOIN users u ON u.id=d.user_id WHERE d.id=?').get(req.params.id);
    if (!d) throw notFound();
    if (isCampus(req.user) && !isSuper(req.user) && d.campus_id !== req.user.campus_id) throw forbidden();
    const b = parse(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req.body);
    if (d.status !== 'pending') throw conflict('This request was already decided.');
    db.prepare('UPDATE duty_leaves SET status=?, decided_by=?, decision_note=?, decided_at=? WHERE id=?').run(b.approve ? 'approved' : 'rejected', req.user.id, b.note ?? null, iso(ctx.now()), d.id);
    ctx.audit(req.user.id, b.approve ? 'dutyleave.approve' : 'dutyleave.reject', 'duty_leave', d.id, { reason: b.note });
    ctx.notify([d.user_id], `Duty leave ${b.approve ? 'approved' : 'declined'}`, b.note || null, '/duty-leave');
    res.json({ ok: true });
  });
  return r;
}
