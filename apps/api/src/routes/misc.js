import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { parse, z, iso, isUnique, conflict, bad, forbidden, notFound } from '../lib/util.js';

export default function miscRoutes(ctx) {
  const r = Router();
  const { db, access: acc } = ctx;
  const A = ctx.auth;

  const memberships = (uid) => db.prepare(`SELECT m.id, m.club_id, c.name club_name, c.campus_id, ca.name campus_name, m.position, m.status, m.is_primary
    FROM memberships m
    JOIN clubs c ON c.id=m.club_id
    JOIN campuses ca ON ca.id=c.campus_id
    WHERE m.user_id=? AND m.status IN ('active','pending') ORDER BY m.is_primary DESC, c.name`).all(uid);

  r.get('/me', A, (req, res) => {
    const u = req.user;
    const campus = u.campus_id ? db.prepare('SELECT id,name,code,city,state FROM campuses WHERE id=?').get(u.campus_id) : null;
    const isSuper = acc.isSuperAdmin(u);
    const allCampuses = isSuper ? db.prepare('SELECT id,name,code,city FROM campuses ORDER BY name').all() : [];

    res.json({
      user: u,
      campus,
      all_campuses: allCampuses,
      memberships: memberships(u.id),
      advisor_clubs: db.prepare(`SELECT c.id,c.name,c.campus_id,ca.name campus_name FROM clubs c
        JOIN campuses ca ON ca.id=c.campus_id
        WHERE c.advisor_id=? OR EXISTS (SELECT 1 FROM faculty_advisor_assignments fa WHERE fa.club_id=c.id AND fa.user_id=?)`).all(u.id, u.id),
      unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(u.id).n,
    });
  });

  // Home screen data for every role
  r.get('/me/overview', A, (req, res) => {
    const u = req.user, nowMs = ctx.now(), nowIso = iso(nowMs), today = nowIso.slice(0, 10);
    const filterCampusId = req.query.campus_id ? Number(req.query.campus_id) : null;
    const mems = memberships(u.id).filter((m) => m.status === 'active');

    // Clubs under oversight
    const clubIds = acc.visibleClubIds(u, filterCampusId);
    const idl = clubIds.length ? clubIds.join(',') : 'NULL';

    const upcoming = db.prepare(`SELECT a.id, a.topic, a.format, a.deliverable, a.venue, a.submission_deadline, cd.date, c.id club_id, c.name club_name,
      (SELECT s.id FROM sessions s WHERE s.activity_id=a.id AND s.status='open' AND s.closes_at>? ) open_session_id,
      (SELECT at.status FROM attendance at JOIN sessions s ON s.id=at.session_id WHERE s.activity_id=a.id AND at.user_id=?) my_attendance
      FROM activities a JOIN club_days cd ON cd.id=a.club_day_id JOIN clubs c ON c.id=a.club_id
      WHERE a.club_id IN (${idl}) AND a.status='approved' AND cd.date>=date(?, '-1 day') ORDER BY cd.date, c.name LIMIT 10`).all(nowIso, u.id, today);

    const openSessions = db.prepare(`SELECT s.id session_id, s.kind, COALESCE(c.name, e.name) club_name, COALESCE(a.topic, 'Event check-in') topic,
      (SELECT at.status FROM attendance at WHERE at.session_id=s.id AND at.user_id=?) my_attendance
      FROM sessions s LEFT JOIN activities a ON a.id=s.activity_id LEFT JOIN clubs c ON c.id=s.club_id LEFT JOIN events e ON e.id=s.event_id
      WHERE s.status='open' AND s.closes_at>? AND ((s.kind='club_day' AND s.club_id IN (${idl}))
        OR (s.kind='event' AND s.event_id IN (SELECT event_id FROM event_regs WHERE user_id=?)))`).all(u.id, nowIso, u.id);

    const due = db.prepare(`SELECT a.id, a.topic, a.submission_deadline, c.name club_name FROM activities a JOIN clubs c ON c.id=a.club_id
      WHERE a.club_id IN (${idl}) AND a.status='approved' AND a.format!='on_the_spot' AND a.submission_deadline>?
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.activity_id=a.id AND s.user_id=?)
      AND EXISTS (SELECT 1 FROM sessions se WHERE se.activity_id=a.id) ORDER BY a.submission_deadline LIMIT 6`).all(nowIso, u.id);

    const scores = db.prepare(`SELECT e.total, e.comment, a.topic, c.name club_name, cd.date FROM evaluations e JOIN submissions s ON s.id=e.submission_id
      JOIN activities a ON a.id=s.activity_id JOIN clubs c ON c.id=a.club_id JOIN club_days cd ON cd.id=a.club_day_id
      WHERE s.user_id=? AND e.published=1 ORDER BY cd.date DESC LIMIT 5`).all(u.id);

    const stats = {
      attended: db.prepare("SELECT COUNT(*) n FROM attendance WHERE user_id=? AND status IN ('present','late')").get(u.id).n,
      submissions: db.prepare('SELECT COUNT(*) n FROM submissions WHERE user_id=?').get(u.id).n,
      certificates: db.prepare("SELECT COUNT(*) n FROM certificates WHERE user_id=? AND status='valid' AND kind!='transcript'").get(u.id).n,
      avg_score: db.prepare('SELECT ROUND(AVG(e.total),2) v FROM evaluations e JOIN submissions s ON s.id=e.submission_id WHERE s.user_id=? AND e.published=1').get(u.id).v,
    };

    const todo = {};
    const leadClubs = mems.filter((m) => m.position === 'president' || m.position === 'vice_president').map((m) => m.club_id);

    // Faculty Advisor specific tasks
    if (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') {
      todo.pending_budget = db.prepare(`SELECT COUNT(*) n FROM budget_requests b
        JOIN clubs c ON c.id=b.club_id
        WHERE (c.advisor_id=? OR EXISTS (SELECT 1 FROM faculty_advisor_assignments fa WHERE fa.club_id=c.id AND fa.user_id=?))
        AND b.status IN ('Submitted to Advisor','pending_president','pending')`).get(u.id, u.id).n;
      todo.pending_plans = db.prepare(`SELECT a.id, a.topic, c.name club_name, cd.date FROM activities a JOIN clubs c ON c.id=a.club_id JOIN club_days cd ON cd.id=a.club_day_id
        WHERE c.advisor_id=? AND a.status='pending' ORDER BY cd.date`).all(u.id);
    }

    // Campus Admin & Super Admin specific tasks
    if (acc.isSuperAdmin(u) || u.system_role === 'campus_admin' || u.system_role === 'campus_manager') {
      const campusFilter = acc.isSuperAdmin(u) ? (filterCampusId ? `AND c.campus_id=${filterCampusId}` : '') : `AND c.campus_id=${Number(u.campus_id)}`;
      todo.pending_clubs = db.prepare(`SELECT c.id, c.name, ca.name campus_name FROM clubs c JOIN campuses ca ON ca.id=c.campus_id WHERE c.status='pending' ${campusFilter}`).all();
      todo.pending_college_budgets = db.prepare(`SELECT COUNT(*) n FROM budget_requests b JOIN clubs c ON c.id=b.club_id
        WHERE b.status IN ('Sent to College','pending_admin') ${campusFilter}`).get().n;
    }

    // Club Treasurer specific overview
    const isTreasurerOf = mems.filter((m) => m.position === 'treasurer').map((m) => m.club_id);
    let treasurer_stats = null;
    if (isTreasurerOf.length > 0) {
      const tl = isTreasurerOf.join(',');
      treasurer_stats = {
        total_requested: db.prepare(`SELECT COALESCE(SUM(amount_inr),0) s FROM budget_requests WHERE club_id IN (${tl})`).get().s,
        total_approved: db.prepare(`SELECT COALESCE(SUM(amount_inr),0) s FROM budget_requests WHERE club_id IN (${tl}) AND status IN ('College Approved','approved')`).get().s,
        pending_review: db.prepare(`SELECT COUNT(*) n FROM budget_requests WHERE club_id IN (${tl}) AND status IN ('Submitted to Advisor','Sent to College','pending_president','pending_admin','pending')`).get().n,
        changes_requested: db.prepare(`SELECT COUNT(*) n FROM budget_requests WHERE club_id IN (${tl}) AND status='Advisor Changes Requested'`).get().n,
      };
    }

    // Staff overview stats for Super Admin / Campus Admin / Advisor
    let staff_stats = null;
    if (u.system_role !== 'student') {
      const isSuper = acc.isSuperAdmin(u);
      const isCampus = u.system_role === 'campus_admin' || u.system_role === 'campus_manager';
      const cId = isSuper ? filterCampusId : u.campus_id;
      const cFilter = cId ? `AND c.campus_id=${Number(cId)}` : '';
      const uFilter = cId ? `AND u.campus_id=${Number(cId)}` : '';

      const totalCampuses = db.prepare('SELECT COUNT(*) n FROM campuses').get().n;
      const totalClubs = db.prepare(`SELECT COUNT(*) n FROM clubs c WHERE c.is_test=0 ${u.system_role === 'faculty_advisor' ? `AND c.advisor_id=${u.id}` : cFilter}`).get().n;
      const totalStudents = db.prepare(`SELECT COUNT(*) n FROM users u WHERE u.system_role='student' AND u.is_test=0 ${u.system_role === 'faculty_advisor' ? `AND u.id IN (SELECT user_id FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE c.advisor_id=${u.id} AND m.status='active')` : uFilter}`).get().n;
      const totalAdvisors = db.prepare(`SELECT COUNT(*) n FROM users u WHERE u.system_role IN ('faculty_advisor','advisor') AND u.is_test=0 ${uFilter}`).get().n;
      const totalBudgetApproved = db.prepare(`SELECT COALESCE(SUM(b.amount_inr),0) s FROM budget_requests b JOIN clubs c ON c.id=b.club_id WHERE b.status IN ('College Approved','approved') ${cFilter}`).get().s;
      const pendingApprovalsCount = db.prepare(`SELECT COUNT(*) n FROM budget_requests b JOIN clubs c ON c.id=b.club_id WHERE b.status IN ('Submitted to Advisor','Sent to College','pending_president','pending_admin') ${cFilter}`).get().n;

      const clubsList = clubIds.length
        ? db.prepare(`SELECT c.id, c.name, c.status, c.campus_id, ca.name campus_name, u.name advisor_name,
            (SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id AND m.status='active') member_count
            FROM clubs c
            JOIN campuses ca ON ca.id=c.campus_id
            LEFT JOIN users u ON u.id=c.advisor_id
            WHERE c.id IN (${idl}) ORDER BY c.name LIMIT 20`).all()
        : [];

      staff_stats = {
        total_campuses: totalCampuses,
        total_clubs: totalClubs,
        total_students: totalStudents,
        total_advisors: totalAdvisors,
        total_budget_approved: totalBudgetApproved,
        pending_approvals_count: pendingApprovalsCount,
        clubs_list: clubsList,
      };
    }

    // Recent announcements for this user's campus and clubs
    const annWhere = acc.isSuperAdmin(u) ? '1=1' : `a.campus_id=${Number(u.campus_id)}`;
    const recentAnnouncements = db.prepare(`SELECT a.*, ca.name campus_name, c.name club_name, u.name author_name
      FROM announcements a
      JOIN campuses ca ON ca.id=a.campus_id
      LEFT JOIN clubs c ON c.id=a.club_id
      LEFT JOIN users u ON u.id=a.author_id
      WHERE ${annWhere}
      ORDER BY a.id DESC LIMIT 5`).all();

    res.json({
      memberships: mems,
      upcoming,
      open_sessions: openSessions,
      due,
      scores,
      stats,
      todo,
      staff_stats,
      treasurer_stats,
      recent_announcements: recentAnnouncements,
    });
  });

  // ---- notifications ----
  r.get('/notifications', A, (req, res) => {
    res.json({
      items: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id),
      unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(req.user.id).n,
    });
  });
  r.post('/notifications/read-all', A, (req, res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });
  r.post('/notifications/:id/read', A, (req, res) => { db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

  // =========================================================================
  // CAMPUSES CRUD (SUPER ADMIN)
  // =========================================================================

  r.get('/campuses', A, (req, res) => {
    const u = req.user;
    const isSuper = acc.isSuperAdmin(u);
    const rows = db.prepare(`SELECT ca.*,
      (SELECT COUNT(*) FROM clubs c WHERE c.campus_id=ca.id AND c.is_test=0) club_count,
      (SELECT COUNT(*) FROM users u WHERE u.campus_id=ca.id AND u.system_role='student' AND u.is_test=0) student_count,
      (SELECT COUNT(*) FROM users u WHERE u.campus_id=ca.id AND u.system_role IN ('faculty_advisor','advisor') AND u.is_test=0) advisor_count,
      (SELECT u.name FROM users u WHERE u.campus_id=ca.id AND u.system_role IN ('campus_admin','campus_manager') LIMIT 1) admin_name,
      (SELECT u.email FROM users u WHERE u.campus_id=ca.id AND u.system_role IN ('campus_admin','campus_manager') LIMIT 1) admin_email
      FROM campuses ca ORDER BY ca.name`).all();

    if (!isSuper && (u.system_role === 'campus_admin' || u.system_role === 'campus_manager')) {
      // Campus Admin sees their campus first/promoted
      return res.json({ items: rows });
    }
    res.json({ items: rows });
  });

  r.post('/campuses', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    const b = parse(z.object({
      name: z.string().min(2).max(100),
      code: z.string().min(2).max(20).optional(),
      city: z.string().min(2).max(100),
      state: z.string().max(100).optional(),
      lat: z.number().optional().default(12.9716),
      lng: z.number().optional().default(77.5946),
      radius_m: z.number().int().min(50).max(50000).default(500),
    }), req.body);

    try {
      const code = b.code ? b.code.toUpperCase() : b.name.slice(0, 4).toUpperCase();
      const info = db.prepare('INSERT INTO campuses(name,code,city,state,lat,lng,radius_m,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(b.name.trim(), code, b.city.trim(), b.state ?? null, b.lat, b.lng, b.radius_m, iso(ctx.now()));
      ctx.audit(req.user.id, 'campus.create', 'campus', info.lastInsertRowid, { neu: b });
      res.status(201).json({ id: info.lastInsertRowid, name: b.name, code });
    } catch (e) {
      if (isUnique(e)) throw conflict('A campus with that name or code already exists.');
      throw e;
    }
  });

  r.patch('/campuses/:id', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    const ca = db.prepare('SELECT * FROM campuses WHERE id=?').get(req.params.id);
    if (!ca) throw notFound('Campus not found');
    const b = parse(z.object({
      name: z.string().min(2).max(100).optional(),
      code: z.string().min(2).max(20).optional(),
      city: z.string().min(2).max(100).optional(),
      state: z.string().max(100).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      radius_m: z.number().int().min(50).max(50000).optional(),
    }), req.body);

    const name = b.name ?? ca.name;
    const code = b.code ? b.code.toUpperCase() : ca.code;
    const city = b.city ?? ca.city;
    const state = b.state ?? ca.state;
    const lat = b.lat ?? ca.lat;
    const lng = b.lng ?? ca.lng;
    const radius_m = b.radius_m ?? ca.radius_m;

    try {
      db.prepare('UPDATE campuses SET name=?,code=?,city=?,state=?,lat=?,lng=?,radius_m=? WHERE id=?')
        .run(name, code, city, state, lat, lng, radius_m, ca.id);
      ctx.audit(req.user.id, 'campus.update', 'campus', ca.id, { old: ca, neu: b });
      res.json({ ok: true });
    } catch (e) {
      if (isUnique(e)) throw conflict('A campus with that name or code already exists.');
      throw e;
    }
  });

  r.delete('/campuses/:id', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    const ca = db.prepare('SELECT * FROM campuses WHERE id=?').get(req.params.id);
    if (!ca) throw notFound('Campus not found');
    const clubCount = db.prepare('SELECT COUNT(*) n FROM clubs WHERE campus_id=?').get(ca.id).n;
    if (clubCount > 0) throw bad(`Cannot delete campus with ${clubCount} clubs. Delete or reassign clubs first.`);

    db.prepare('DELETE FROM campuses WHERE id=?').run(ca.id);
    ctx.audit(req.user.id, 'campus.delete', 'campus', ca.id, { old: ca });
    res.json({ ok: true });
  });

  // ---- Assign Campus Admin to Campus (Super Admin) ----
  r.post('/campuses/:id/assign-admin', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    const ca = db.prepare('SELECT * FROM campuses WHERE id=?').get(req.params.id);
    if (!ca) throw notFound('Campus not found');
    const { user_id } = parse(z.object({ user_id: z.number().int() }), req.body);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(user_id);
    if (!u) throw notFound('User not found');

    db.prepare("UPDATE users SET campus_id=?, system_role='campus_admin' WHERE id=?").run(ca.id, u.id);
    ctx.audit(req.user.id, 'campus.assign_admin', 'campus', ca.id, { admin_id: u.id, admin_name: u.name });
    ctx.notify([u.id], `Assigned as Campus Admin: ${ca.name}`, 'You now manage this campus.', '/');
    res.json({ ok: true });
  });

  // =========================================================================
  // USERS MANAGEMENT WITH CAMPUS ISOLATION
  // =========================================================================

  r.get('/users', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager', 'faculty_advisor', 'advisor'), (req, res) => {
    const { q = '', role = '', campus_id } = req.query;
    const u = req.user;
    let sql = `SELECT u.id,u.name,u.email,u.student_code,u.system_role,u.campus_id,ca.name campus_name,ca.city campus_city
      FROM users u
      LEFT JOIN campuses ca ON ca.id=u.campus_id
      WHERE u.is_test=0`;
    const params = [];

    // Role filter
    if (role) {
      if (role === 'admin' || role === 'super_admin') {
        sql += " AND u.system_role IN ('super_admin','admin')";
      } else if (role === 'campus_admin' || role === 'campus_manager') {
        sql += " AND u.system_role IN ('campus_admin','campus_manager')";
      } else if (role === 'faculty_advisor' || role === 'advisor') {
        sql += " AND u.system_role IN ('faculty_advisor','advisor')";
      } else {
        sql += ' AND u.system_role=?';
        params.push(role);
      }
    }

    // Search query
    if (q) {
      sql += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.student_code LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    // STRICT Campus Isolation:
    if (acc.isSuperAdmin(u)) {
      if (campus_id) {
        sql += ' AND u.campus_id=?';
        params.push(Number(campus_id));
      }
    } else {
      // Campus Admin & Advisor CANNOT see users of other campuses!
      sql += ' AND u.campus_id=?';
      params.push(u.campus_id);
    }

    sql += ' ORDER BY u.name LIMIT 150';
    const rows = db.prepare(sql).all(...params);
    res.json({ items: rows });
  });

  r.post('/users', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const b = parse(z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      student_code: z.string().min(3).max(30).optional(),
      system_role: z.enum(['super_admin', 'admin', 'campus_admin', 'campus_manager', 'faculty_advisor', 'advisor', 'student']),
      password: z.string().min(6).max(100),
      campus_id: z.number().int().optional(),
    }), req.body);

    const isSuper = acc.isSuperAdmin(req.user);
    let targetCampusId = isSuper ? (b.campus_id ?? req.user.campus_id) : req.user.campus_id;
    let targetRole = b.system_role;

    // Normalization
    if (targetRole === 'admin') targetRole = 'super_admin';
    if (targetRole === 'campus_manager') targetRole = 'campus_admin';
    if (targetRole === 'advisor') targetRole = 'faculty_advisor';

    if (!isSuper && (targetRole === 'super_admin' || targetRole === 'admin')) {
      throw forbidden('Only Super Admin can create admin accounts.');
    }

    try {
      const info = db.prepare('INSERT INTO users(campus_id,name,email,student_code,password_hash,system_role,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(targetCampusId, b.name.trim(), b.email.toLowerCase().trim(), b.student_code?.toUpperCase().trim() ?? null, bcrypt.hashSync(b.password, 10), targetRole, iso(ctx.now()));
      ctx.audit(req.user.id, 'user.create', 'user', info.lastInsertRowid, { neu: { email: b.email, role: targetRole, campus_id: targetCampusId } });
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) {
      if (isUnique(e)) throw conflict('A user with that email or student ID already exists.');
      throw e;
    }
  });

  r.patch('/users/:id', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) throw notFound('User not found');
    const isSuper = acc.isSuperAdmin(req.user);

    // Campus admin cannot edit users of other campuses or super admins
    if (!isSuper && (u.campus_id !== req.user.campus_id || u.system_role === 'super_admin' || u.system_role === 'admin')) {
      throw forbidden('You can only edit users within your assigned campus.');
    }

    const b = parse(z.object({
      name: z.string().min(2).max(100).optional(),
      email: z.string().email().optional(),
      student_code: z.string().min(3).max(30).nullable().optional(),
      system_role: z.enum(['super_admin', 'admin', 'campus_admin', 'campus_manager', 'faculty_advisor', 'advisor', 'student']).optional(),
      campus_id: z.number().int().optional(),
      password: z.string().min(6).max(100).optional(),
    }), req.body);

    const name = b.name ?? u.name;
    const email = b.email ? b.email.toLowerCase().trim() : u.email;
    const studentCode = 'student_code' in b ? (b.student_code ? b.student_code.toUpperCase().trim() : null) : u.student_code;
    const role = isSuper ? (b.system_role ?? u.system_role) : u.system_role;
    const campusId = isSuper ? (b.campus_id ?? u.campus_id) : u.campus_id;
    const passHash = b.password ? bcrypt.hashSync(b.password, 10) : u.password_hash;

    try {
      db.prepare('UPDATE users SET name=?,email=?,student_code=?,system_role=?,campus_id=?,password_hash=? WHERE id=?')
        .run(name, email, studentCode, role, campusId, passHash, u.id);
      ctx.audit(req.user.id, 'user.update', 'user', u.id, { old: { name: u.name, role: u.system_role, email: u.email }, neu: b });
      res.json({ ok: true });
    } catch (e) {
      if (isUnique(e)) throw conflict('A user with that email or student ID already exists.');
      throw e;
    }
  });

  r.delete('/users/:id', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) throw notFound('User not found');
    if (u.id === req.user.id) throw bad('You cannot delete your own account.');
    const isSuper = acc.isSuperAdmin(req.user);
    if (!isSuper && (u.campus_id !== req.user.campus_id || u.system_role === 'super_admin' || u.system_role === 'admin')) {
      throw forbidden('You can only delete users within your assigned campus.');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM notifications WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM memberships WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM faculty_advisor_assignments WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM budget_approvals WHERE actor_id=?').run(u.id);
      db.prepare('DELETE FROM budget_approvals WHERE budget_request_id IN (SELECT id FROM budget_requests WHERE requested_by=?)').run(u.id);
      db.prepare('DELETE FROM budget_requests WHERE requested_by=?').run(u.id);
      db.prepare('UPDATE budget_requests SET decided_by=NULL WHERE decided_by=?').run(u.id);
      db.prepare('UPDATE budget_requests SET president_decided_by=NULL WHERE president_decided_by=?').run(u.id);
      db.prepare('DELETE FROM announcements WHERE author_id=?').run(u.id);
      db.prepare('DELETE FROM activity_leaves WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM duty_leaves WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM attendance WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM event_regs WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM certificates WHERE user_id=?').run(u.id);
      db.prepare('UPDATE clubs SET advisor_id=NULL WHERE advisor_id=?').run(u.id);
      db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    })();
    ctx.audit(req.user.id, 'user.delete', 'user', u.id, { old: { name: u.name, email: u.email } });
    res.json({ ok: true });
  });

  // =========================================================================
  // ANNOUNCEMENTS
  // =========================================================================

  r.get('/announcements', A, (req, res) => {
    const u = req.user;
    const filterCampusId = req.query.campus_id ? Number(req.query.campus_id) : null;
    let sql = `SELECT a.*, ca.name campus_name, c.name club_name, u.name author_name
      FROM announcements a
      JOIN campuses ca ON ca.id=a.campus_id
      LEFT JOIN clubs c ON c.id=a.club_id
      LEFT JOIN users u ON u.id=a.author_id
      WHERE 1=1`;
    const params = [];

    if (acc.isSuperAdmin(u)) {
      if (filterCampusId) {
        sql += ' AND a.campus_id=?';
        params.push(filterCampusId);
      }
    } else {
      sql += ' AND a.campus_id=?';
      params.push(u.campus_id);
    }

    sql += ' ORDER BY a.id DESC LIMIT 50';
    res.json({ items: db.prepare(sql).all(...params) });
  });

  r.post('/announcements', A, (req, res) => {
    const u = req.user;
    const b = parse(z.object({
      title: z.string().min(2).max(120),
      body: z.string().min(2).max(2000),
      club_id: z.number().int().optional(),
      campus_id: z.number().int().optional(),
    }), req.body);

    const isSuper = acc.isSuperAdmin(u);
    const targetCampusId = isSuper ? (b.campus_id ?? u.campus_id) : u.campus_id;
    if (!targetCampusId) throw bad('Campus ID is required.');

    const info = db.prepare('INSERT INTO announcements(campus_id,club_id,title,body,author_id,is_public,created_at) VALUES (?,?,?,?,?,1,?)')
      .run(targetCampusId, b.club_id ?? null, b.title, b.body, u.id, iso(ctx.now()));

    // Notify users
    let notifyUserIds = [];
    if (b.club_id) {
      notifyUserIds = db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND user_id!=?").all(b.club_id, u.id).map((x) => x.user_id);
    } else {
      notifyUserIds = db.prepare('SELECT id FROM users WHERE campus_id=? AND id!=?').all(targetCampusId, u.id).map((x) => x.id);
    }
    ctx.notify(notifyUserIds, `Announcement: ${b.title}`, b.body.slice(0, 100), '/');

    ctx.audit(u.id, 'announcement.create', 'announcement', info.lastInsertRowid, { neu: b });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  // ---- Activity leaves ----
  r.get('/activity-leaves', A, (req, res) => {
    const u = req.user;
    const leadClubs = memberships(u.id).filter((m) => m.status === 'active' && (m.position === 'president' || m.position === 'vice_president')).map((m) => m.club_id);
    let rows;
    if (acc.isSuperAdmin(u)) {
      rows = db.prepare(`SELECT l.*, c.name club_name, cd.date club_day_date, cd.title club_day_title, a.topic activity_topic, u.name student_name, u.student_code, dec.name decided_by_name
        FROM activity_leaves l JOIN clubs c ON c.id=l.club_id LEFT JOIN club_days cd ON cd.id=l.club_day_id LEFT JOIN activities a ON a.id=l.activity_id
        JOIN users u ON u.id=l.user_id LEFT JOIN users dec ON dec.id=l.decided_by ORDER BY l.id DESC LIMIT 200`).all();
    } else if (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') {
      rows = db.prepare(`SELECT l.*, c.name club_name, cd.date club_day_date, cd.title club_day_title, a.topic activity_topic, u.name student_name, u.student_code, dec.name decided_by_name
        FROM activity_leaves l JOIN clubs c ON c.id=l.club_id LEFT JOIN club_days cd ON cd.id=l.club_day_id LEFT JOIN activities a ON a.id=l.activity_id
        JOIN users u ON u.id=l.user_id LEFT JOIN users dec ON dec.id=l.decided_by
        WHERE c.campus_id=? ORDER BY l.id DESC LIMIT 200`).all(u.campus_id);
    } else if (leadClubs.length > 0) {
      rows = db.prepare(`SELECT l.*, c.name club_name, cd.date club_day_date, cd.title club_day_title, a.topic activity_topic, u.name student_name, u.student_code, dec.name decided_by_name
        FROM activity_leaves l JOIN clubs c ON c.id=l.club_id LEFT JOIN club_days cd ON cd.id=l.club_day_id LEFT JOIN activities a ON a.id=l.activity_id
        JOIN users u ON u.id=l.user_id LEFT JOIN users dec ON dec.id=l.decided_by
        WHERE l.club_id IN (${leadClubs.join(',')}) OR l.user_id=? ORDER BY l.id DESC LIMIT 200`).all(u.id);
    } else {
      rows = db.prepare(`SELECT l.*, c.name club_name, cd.date club_day_date, cd.title club_day_title, a.topic activity_topic, u.name student_name, u.student_code, dec.name decided_by_name
        FROM activity_leaves l JOIN clubs c ON c.id=l.club_id LEFT JOIN club_days cd ON cd.id=l.club_day_id LEFT JOIN activities a ON a.id=l.activity_id
        JOIN users u ON u.id=l.user_id LEFT JOIN users dec ON dec.id=l.decided_by
        WHERE l.user_id=? ORDER BY l.id DESC LIMIT 100`).all(u.id);
    }
    res.json({ items: rows });
  });

  r.post('/activity-leaves', A, (req, res) => {
    const b = parse(z.object({
      club_id: z.number().int(),
      club_day_id: z.number().int().optional(),
      activity_id: z.number().int().optional(),
      reason: z.string().min(3).max(500),
    }), req.body);
    const c = acc.club(b.club_id);
    const mem = acc.membership(req.user.id, c.id);
    if (!mem || mem.status !== 'active') throw forbidden('You are not an active member of this club.');
    const t = iso(ctx.now());
    const info = db.prepare("INSERT INTO activity_leaves(club_id,club_day_id,activity_id,user_id,reason,status,created_at) VALUES (?,?,?,?,?,'pending',?)")
      .run(c.id, b.club_day_id ?? null, b.activity_id ?? null, req.user.id, b.reason, t);
    const leads = db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND position IN ('president','vice_president')").all(c.id).map((x) => x.user_id);
    ctx.notify(leads, `Leave request from ${req.user.name}`, `${c.name}: ${b.reason}`, '/duty-leave');
    ctx.audit(req.user.id, 'activity_leave.request', 'activity_leave', info.lastInsertRowid, { neu: b });
    res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
  });

  r.post('/activity-leaves/:id/decision', A, (req, res) => {
    const l = db.prepare('SELECT * FROM activity_leaves WHERE id=?').get(req.params.id);
    if (!l) throw notFound('Activity leave request not found');
    const c = acc.club(l.club_id);
    acc.require(acc.canManageClub(req.user, c) || acc.isAdvisor(req.user, c) || acc.isCampusAdmin(req.user, c), 'Permission denied.');
    const b = parse(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req.body);
    if (l.status !== 'pending') throw conflict('This request has already been decided.');
    const nextStatus = b.approve ? 'approved' : 'rejected';
    const t = iso(ctx.now());
    db.prepare('UPDATE activity_leaves SET status=?, decided_by=?, decision_note=?, decided_at=? WHERE id=?')
      .run(nextStatus, req.user.id, b.note ?? null, t, l.id);
    ctx.audit(req.user.id, b.approve ? 'activity_leave.approve' : 'activity_leave.reject', 'activity_leave', l.id, { reason: b.note });
    ctx.notify([l.user_id], `Leave request ${b.approve ? 'approved' : 'declined'} for ${c.name}`, b.note || (b.approve ? 'Your leave was approved.' : 'Your leave was declined.'), '/');
    res.json({ ok: true, status: nextStatus });
  });

  // ---- Settings & Audit ----
  r.get('/audit', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({
      items: db.prepare(`SELECT l.*, u.name actor, u.email actor_email
        FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id
        WHERE (?='' OR l.action LIKE ?) ORDER BY l.id DESC LIMIT ?`).all(req.query.q || '', `${req.query.q || ''}%`, limit),
    });
  });

  r.get('/settings', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    res.json(Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((s) => [s.key, JSON.parse(s.value)])));
  });

  r.put('/settings', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    const b = parse(z.object({
      max_clubs_per_student: z.number().int().min(1).max(10).optional(),
      checkin_window_minutes: z.number().int().min(1).max(1440).optional(),
      late_after_minutes: z.number().int().min(0).max(1440).optional(),
      geo_mode: z.enum(['off', 'flag', 'block']).optional(),
      rubric_weights: z.object({ content: z.number().min(0).max(100), presentation: z.number().min(0).max(100), participation: z.number().min(0).max(100) }).optional(),
      inactive_days: z.number().int().min(1).max(365).optional(),
      max_upload_mb: z.number().int().min(1).max(50).optional(),
    }), req.body);
    const up = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(b)) {
      ctx.audit(req.user.id, 'settings.update', 'setting', k, { old: ctx.setting(k), neu: v });
      up.run(k, JSON.stringify(v));
    }
    res.json({ ok: true });
  });

  r.get('/outbox', A, ctx.roles('super_admin', 'admin'), (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all() });
  });

  return r;
}
