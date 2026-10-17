import { Router } from 'express';
import { parse, z, iso, isUnique, conflict, bad, forbidden, notFound } from '../lib/util.js';

const POSITIONS = ['president', 'vice_president', 'treasurer', 'member'];
const LABEL = { president: 'President', vice_president: 'Vice President', treasurer: 'Treasurer', member: 'Member' };

export default function clubRoutes(ctx) {
  const r = Router();
  const { db, access: acc } = ctx;
  const A = ctx.auth;

  const activeCount = (clubId) => db.prepare("SELECT COUNT(*) n FROM memberships WHERE club_id=? AND status='active'").get(clubId).n;
  const coordIds = (clubId) => db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND position IN ('president','vice_president')").all(clubId).map((x) => x.user_id);

  // ---- clubs list ----
  r.get('/clubs', A, (req, res) => {
    const u = req.user;
    const filterCampusId = req.query.campus_id ? Number(req.query.campus_id) : null;
    const filterMyOnly = req.query.my === '1' || req.query.filter === 'my';

    let sql = `SELECT c.id,c.name,c.category,c.description,c.meeting_rules,c.capacity,c.status,c.campus_id,ca.name campus,ca.city campus_city,c.advisor_id,a.name advisor_name,
      (SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id AND m.status='active') member_count
      FROM clubs c JOIN campuses ca ON ca.id=c.campus_id LEFT JOIN users a ON a.id=c.advisor_id WHERE c.is_test=0`;
    const params = [];

    if (acc.isSuperAdmin(u)) {
      if (filterCampusId) {
        sql += ' AND c.campus_id=?';
        params.push(filterCampusId);
      }
    } else if (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') {
      sql += ' AND c.campus_id=?';
      params.push(u.campus_id);
    } else if (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') {
      // Faculty Advisor ONLY sees their assigned club(s)
      sql += ` AND (c.advisor_id=? OR EXISTS (SELECT 1 FROM faculty_advisor_assignments fa WHERE fa.club_id=c.id AND fa.user_id=?))`;
      params.push(u.id, u.id);
    } else {
      // Student / Club Treasurer / Club Member ONLY sees clubs they have actively joined
      sql += ` AND EXISTS (SELECT 1 FROM memberships m WHERE m.club_id=c.id AND m.user_id=? AND m.status='active')`;
      params.push(u.id);
    }

    sql += ' ORDER BY c.name';
    const rows = db.prepare(sql).all(...params);
    const mine = new Map(db.prepare('SELECT club_id,status,position FROM memberships WHERE user_id=?').all(u.id).map((m) => [m.club_id, m]));

    res.json({
      items: rows.map((c) => ({
        ...c,
        my_status: mine.get(c.id)?.status ?? (c.advisor_id === u.id ? 'active' : null),
        my_position: mine.get(c.id)?.position ?? (c.advisor_id === u.id ? 'advisor' : null),
        is_my_club: true,
      })),
    });
  });

  // ---- club details ----
  r.get('/clubs/:id', A, (req, res) => {
    const u = req.user;
    const c = acc.club(req.params.id);

    // Strict campus isolation: cannot access clubs of another campus unless Super Admin
    if (!acc.canAccessCampus(u, c.campus_id)) {
      throw forbidden('You do not have access to clubs from other campuses.');
    }

    // Strict club isolation: non-admins can ONLY access their assigned or joined club
    if (!acc.isSuperAdmin(u) && !acc.isCampusAdmin(u, c)) {
      const isAssignedAdvisor = (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') &&
        (c.advisor_id === u.id || !!db.prepare('SELECT 1 FROM faculty_advisor_assignments WHERE club_id=? AND user_id=?').get(c.id, u.id));
      const isActiveMember = !!db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND club_id=? AND status='active'").get(u.id, c.id);

      if (!isAssignedAdvisor && !isActiveMember) {
        throw forbidden('You do not have access to this club. You can only view clubs you have joined or are assigned to.');
      }
    }

    if (c.status !== 'approved' && !acc.isStaff(u, c)) {
      throw notFound('Club not found');
    }

    const advisor = c.advisor_id ? db.prepare('SELECT id,name,email FROM users WHERE id=?').get(c.advisor_id) : null;
    const mine = acc.membership(u.id, c.id);

    // Strict club data isolation: students only see member list if they are active members of this club!
    const canSeeMembers = acc.canViewMembers(u, c);
    const members = canSeeMembers
      ? db.prepare(`SELECT m.id membership_id, u.id user_id, u.name, u.email, u.student_code, m.position, m.created_at joined_at
          FROM memberships m JOIN users u ON u.id=m.user_id
          WHERE m.club_id=? AND m.status='active'
          ORDER BY CASE m.position WHEN 'president' THEN 0 WHEN 'vice_president' THEN 1 WHEN 'treasurer' THEN 2 ELSE 3 END, u.name`).all(c.id)
      : null;

    // Public approved budget summary for club members
    const approvedBudgets = (acc.isMember(u, c) || acc.isStaff(u, c))
      ? db.prepare(`SELECT id, title, category, amount_inr, decided_at, purpose
          FROM budget_requests WHERE club_id=? AND status IN ('College Approved','college_approved','approved') ORDER BY id DESC LIMIT 5`).all(c.id)
      : [];

    const isTreas = mine?.position === 'treasurer';
    const isCoord = acc.isCoordinator(u, c.id);

    res.json({
      club: {
        ...c,
        campus: db.prepare('SELECT name FROM campuses WHERE id=?').get(c.campus_id)?.name || 'Campus',
        member_count: activeCount(c.id),
      },
      advisor,
      members,
      approved_budgets: approvedBudgets,
      my: {
        status: db.prepare('SELECT status FROM memberships WHERE user_id=? AND club_id=?').get(u.id, c.id)?.status ?? null,
        position: mine?.position ?? null,
      },
      can: {
        manage: acc.canManageClub(u, c) || acc.isAdvisor(u, c),
        run: acc.canRun(u, c),
        review: acc.canReviewPlan(u, c),
        admin: acc.isAdmin(u),
        approve_club: acc.isAdmin(u) || acc.isCampusAdmin(u, c),
        create_budget: acc.isAdmin(u) || isCoord || isTreas,
        view_budget: acc.isStaff(u, c) || isCoord || isTreas || acc.isMember(u, c),
        edit_club: acc.canManageClub(u, c) || acc.isCampusAdmin(u, c),
        manage_members: acc.canManageClub(u, c) || acc.isAdvisor(u, c) || acc.isCampusAdmin(u, c),
      },
    });
  });

  const clubBody = z.object({
    name: z.string().min(2).max(80),
    category: z.string().max(40).optional(),
    description: z.string().max(1000).optional(),
    meeting_rules: z.string().max(1000).optional(),
    capacity: z.number().int().min(1).max(500).optional(),
    advisor_id: z.number().int().nullable().optional(),
    campus_id: z.number().int().optional(),
  });

  const checkAdvisor = (id, campusId) => {
    if (id == null) return;
    const a = db.prepare("SELECT id,campus_id FROM users WHERE id=? AND system_role IN ('faculty_advisor','advisor')").get(id);
    if (!a) throw bad('Choose a user with the Faculty Advisor role.');
    if (a.campus_id !== campusId) throw bad('The advisor must belong to the same campus as the club.');
  };

  // ---- create club (Super Admin or Campus Admin) ----
  r.post('/clubs', A, ctx.roles('super_admin', 'admin', 'campus_admin', 'campus_manager'), (req, res) => {
    const b = parse(clubBody, req.body);
    const campusId = acc.isSuperAdmin(req.user) ? (b.campus_id ?? req.user.campus_id) : req.user.campus_id;
    if (!campusId) throw bad('Campus ID is required.');
    checkAdvisor(b.advisor_id, campusId);

    const initialStatus = acc.isSuperAdmin(req.user) || (req.user.system_role === 'campus_admin' || req.user.system_role === 'campus_manager')
      ? 'approved'
      : 'pending';

    try {
      const info = db.prepare(`INSERT INTO clubs(campus_id,name,category,description,meeting_rules,advisor_id,capacity,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(campusId, b.name.trim(), b.category ?? null, b.description ?? null, b.meeting_rules ?? null, b.advisor_id ?? null, b.capacity ?? 20, initialStatus, iso(ctx.now()));

      if (b.advisor_id) {
        db.prepare('INSERT OR IGNORE INTO faculty_advisor_assignments(club_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)')
          .run(info.lastInsertRowid, b.advisor_id, req.user.id, iso(ctx.now()));
      }

      ctx.audit(req.user.id, 'club.create', 'club', info.lastInsertRowid, { neu: b });
      res.status(201).json({ id: info.lastInsertRowid, status: initialStatus });
    } catch (e) {
      if (isUnique(e)) throw conflict('A club with that name already exists on this campus.');
      throw e;
    }
  });

  // ---- update club ----
  r.patch('/clubs/:id', A, (req, res) => {
    const c = acc.club(req.params.id);
    acc.require(acc.canManageClub(req.user, c) || acc.isCampusAdmin(req.user, c) || acc.isAdvisor(req.user, c), 'Permission denied to edit this club.');
    const b = parse(clubBody.partial(), req.body);
    if (b.capacity != null && b.capacity < activeCount(c.id)) throw conflict(`This club already has ${activeCount(c.id)} active members. Capacity cannot be lower.`);

    if ('advisor_id' in b && b.advisor_id != null) {
      checkAdvisor(b.advisor_id, c.campus_id);
      db.prepare('INSERT OR REPLACE INTO faculty_advisor_assignments(club_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)')
        .run(c.id, b.advisor_id, req.user.id, iso(ctx.now()));
    }

    const n = { ...c, ...b };
    try {
      db.prepare('UPDATE clubs SET name=?,category=?,description=?,meeting_rules=?,advisor_id=?,capacity=? WHERE id=?')
        .run(n.name, n.category, n.description, n.meeting_rules, n.advisor_id, n.capacity, c.id);
    } catch (e) {
      if (isUnique(e)) throw conflict('A club with that name already exists on this campus.');
      throw e;
    }
    ctx.audit(req.user.id, 'club.update', 'club', c.id, { old: { name: c.name, capacity: c.capacity, advisor_id: c.advisor_id }, neu: b });
    res.json({ ok: true });
  });

  // ---- delete club (Super Admin or Campus Admin of that campus) ----
  r.delete('/clubs/:id', A, (req, res) => {
    const c = acc.club(req.params.id);
    acc.require(acc.isSuperAdmin(req.user) || acc.isCampusAdmin(req.user, c), 'Only Super Admin or Campus Admin can delete a club.');
    db.transaction(() => {
      db.prepare('DELETE FROM budget_approvals WHERE budget_request_id IN (SELECT id FROM budget_requests WHERE club_id=?)').run(c.id);
      db.prepare('DELETE FROM budget_requests WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM faculty_advisor_assignments WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM announcements WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM activity_leaves WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM monthly_reports WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM certificates WHERE club_id=?').run(c.id);
      const actIds = db.prepare('SELECT id FROM activities WHERE club_id=?').all(c.id).map((x) => x.id);
      for (const aid of actIds) {
        const sess = db.prepare('SELECT id FROM sessions WHERE activity_id=?').get(aid);
        if (sess) {
          db.prepare('DELETE FROM attendance WHERE session_id=?').run(sess.id);
          db.prepare('DELETE FROM sessions WHERE id=?').run(sess.id);
        }
        const subs = db.prepare('SELECT id FROM submissions WHERE activity_id=?').all(aid).map((x) => x.id);
        for (const sid of subs) {
          db.prepare('DELETE FROM evaluations WHERE submission_id=?').run(sid);
        }
        db.prepare('DELETE FROM submissions WHERE activity_id=?').run(aid);
      }
      db.prepare('DELETE FROM activities WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM memberships WHERE club_id=?').run(c.id);
      db.prepare('DELETE FROM clubs WHERE id=?').run(c.id);
    })();
    ctx.audit(req.user.id, 'club.delete', 'club', c.id, { old: { name: c.name } });
    res.json({ ok: true });
  });

  // ---- club status (approve/archive) ----
  r.post('/clubs/:id/status', A, (req, res) => {
    const c = acc.club(req.params.id);
    acc.require(acc.isSuperAdmin(req.user) || acc.isCampusAdmin(req.user, c), 'Only Super Admin or Campus Admin can approve clubs.');
    const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'archived']) }), req.body);
    db.prepare('UPDATE clubs SET status=? WHERE id=?').run(status, c.id);
    ctx.audit(req.user.id, 'club.status', 'club', c.id, { old: c.status, neu: status });
    if (status === 'approved' && c.advisor_id) ctx.notify([c.advisor_id], `${c.name} is approved`, 'You are the faculty advisor for this club.', `/clubs/${c.id}`);
    res.json({ ok: true });
  });

  // ---- membership management ----
  const leadershipError = (position) => conflict(`This club already has a ${LABEL[position]}. Change their position first.`);

  r.post('/clubs/:id/join', A, ctx.roles('student'), (req, res) => {
    const u = req.user, c = acc.club(req.params.id);
    if (c.status !== 'approved' || c.campus_id !== u.campus_id) throw notFound('Club not found');
    const existing = db.prepare('SELECT * FROM memberships WHERE club_id=? AND user_id=?').get(c.id, u.id);
    if (existing && ['active', 'pending'].includes(existing.status)) throw conflict(existing.status === 'active' ? 'You are already a member of this club.' : 'Your request is already waiting for approval.');
    const max = ctx.setting('max_clubs_per_student') || 3;
    const have = db.prepare("SELECT COUNT(*) n FROM memberships WHERE user_id=? AND status IN ('active','pending')").get(u.id).n;
    if (have >= max) throw conflict(`You can belong to at most ${max} clubs.`);
    if (activeCount(c.id) >= c.capacity) throw conflict('This club is full. Ask coordinators to increase capacity.');
    const t = iso(ctx.now());
    if (existing) db.prepare("UPDATE memberships SET status='pending', position='member', is_primary=?, created_at=?, decided_at=NULL WHERE id=?").run(have === 0 ? 1 : 0, t, existing.id);
    else db.prepare("INSERT INTO memberships(club_id,user_id,position,is_primary,status,created_at) VALUES (?,?,'member',?,'pending',?)").run(c.id, u.id, have === 0 ? 1 : 0, t);
    ctx.notify([...coordIds(c.id), c.advisor_id], `${u.name} wants to join ${c.name}`, 'Review the request under Club Requests.', `/clubs/${c.id}`);
    res.status(201).json({ status: 'pending' });
  });

  r.post('/clubs/:id/leave', A, (req, res) => {
    const c = acc.club(req.params.id);
    const m = db.prepare("SELECT * FROM memberships WHERE club_id=? AND user_id=? AND status IN ('active','pending')").get(c.id, req.user.id);
    if (!m) throw notFound('You are not a member of this club.');
    if (m.position !== 'member') throw conflict('Club officers cannot leave directly. Reassign your position first.');
    db.prepare("UPDATE memberships SET status='left', decided_at=? WHERE id=?").run(iso(ctx.now()), m.id);
    res.json({ ok: true });
  });

  r.get('/clubs/:id/requests', A, (req, res) => {
    const c = acc.club(req.params.id);
    acc.require(acc.canViewClubData(req.user, c));
    res.json({
      items: db.prepare(`SELECT m.id, m.created_at, u.id user_id, u.name, u.student_code FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.club_id=? AND m.status='pending' ORDER BY m.created_at`).all(c.id),
      capacity: c.capacity,
      active: activeCount(c.id),
    });
  });

  r.post('/memberships/:id/decision', A, (req, res) => {
    const m = db.prepare('SELECT * FROM memberships WHERE id=?').get(req.params.id);
    if (!m) throw notFound();
    const c = acc.club(m.club_id);
    acc.require(acc.canViewClubData(req.user, c), 'Only the club coordinators, advisor, or admin can decide join requests.');
    const { approve, note } = parse(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req.body);
    if (m.status !== 'pending') throw conflict('This request has already been decided.');
    if (approve && activeCount(c.id) >= c.capacity) throw conflict('The club is full. Raise capacity before approving.');
    db.prepare('UPDATE memberships SET status=?, note=?, decided_at=? WHERE id=?').run(approve ? 'active' : 'rejected', note ?? null, iso(ctx.now()), m.id);
    ctx.audit(req.user.id, approve ? 'membership.approve' : 'membership.reject', 'membership', m.id, { reason: note });
    ctx.notify([m.user_id], approve ? `You joined ${c.name}` : `Your request to join ${c.name} was declined`, note || null, `/clubs/${c.id}`);
    res.json({ ok: true });
  });

  // ---- add member directly (Campus Admin, Super Admin, Advisor, or Club Leader) ----
  r.post('/clubs/:id/members', A, (req, res) => {
    const c = acc.club(req.params.id);
    acc.require(acc.canManageClub(req.user, c) || acc.isAdvisor(req.user, c) || acc.isCampusAdmin(req.user, c), 'Permission denied to add members.');
    const b = parse(z.object({ user_id: z.number().int(), position: z.enum(POSITIONS).default('member') }), req.body);
    const s = db.prepare("SELECT id,campus_id FROM users WHERE id=? AND system_role='student'").get(b.user_id);
    if (!s) throw bad('User is not a student.');
    if (!acc.isSuperAdmin(req.user) && s.campus_id !== c.campus_id) throw bad('Student must belong to the same campus as this club.');
    const ex = db.prepare('SELECT * FROM memberships WHERE club_id=? AND user_id=?').get(c.id, b.user_id);
    if ((!ex || ex.status !== 'active') && activeCount(c.id) >= c.capacity) throw conflict('This club is full.');
    const others = db.prepare("SELECT COUNT(*) n FROM memberships WHERE user_id=? AND status='active' AND club_id!=?").get(b.user_id, c.id).n;
    const t = iso(ctx.now());
    try {
      if (ex) db.prepare("UPDATE memberships SET status='active', position=?, decided_at=? WHERE id=?").run(b.position, t, ex.id);
      else db.prepare("INSERT INTO memberships(club_id,user_id,position,is_primary,status,created_at,decided_at) VALUES (?,?,?,?, 'active',?,?)").run(c.id, b.user_id, b.position, others ? 0 : 1, t, t);
    } catch (e) {
      if (isUnique(e)) throw leadershipError(b.position);
      throw e;
    }
    ctx.audit(req.user.id, 'membership.add', 'club', c.id, { neu: b });
    ctx.notify([b.user_id], `You were added to ${c.name}`, `Your role: ${LABEL[b.position]}`, `/clubs/${c.id}`);
    res.status(201).json({ ok: true });
  });

  r.delete('/memberships/:id', A, (req, res) => {
    const m = db.prepare('SELECT * FROM memberships WHERE id=?').get(req.params.id);
    if (!m) throw notFound('Membership not found');
    const c = acc.club(m.club_id);
    acc.require(acc.canManageClub(req.user, c) || acc.isAdvisor(req.user, c) || acc.isCampusAdmin(req.user, c), 'Permission denied to remove member.');
    db.prepare('DELETE FROM memberships WHERE id=?').run(m.id);
    ctx.audit(req.user.id, 'membership.remove', 'club', c.id, { old: { user_id: m.user_id, position: m.position } });
    ctx.notify([m.user_id], `You were removed from ${c.name}`, 'Contact club coordinators for questions.', '/clubs');
    res.json({ ok: true });
  });

  r.patch('/memberships/:id', A, (req, res) => {
    const m = db.prepare('SELECT * FROM memberships WHERE id=?').get(req.params.id);
    if (!m) throw notFound();
    const c = acc.club(m.club_id);
    acc.require(acc.canManageClub(req.user, c) || acc.isAdvisor(req.user, c) || acc.isCampusAdmin(req.user, c), 'Permission denied.');
    const { position } = parse(z.object({ position: z.enum(POSITIONS) }), req.body);
    try {
      db.prepare('UPDATE memberships SET position=? WHERE id=?').run(position, m.id);
    } catch (e) {
      if (isUnique(e)) throw leadershipError(position);
      throw e;
    }
    ctx.audit(req.user.id, 'membership.position', 'membership', m.id, { old: m.position, neu: position });
    res.json({ ok: true });
  });

  r.post('/clubs/:id/announce', A, (req, res) => {
    const c = acc.club(req.params.id);
    acc.require(acc.canRun(req.user, c) || acc.isAdvisor(req.user, c) || acc.isCampusAdmin(req.user, c), 'Only coordinators, advisor, or admin can send announcements.');
    const b = parse(z.object({ title: z.string().min(2).max(120), body: z.string().min(2).max(1000) }), req.body);
    const ids = db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND user_id!=?").all(c.id, req.user.id).map((x) => x.user_id);

    // Save in announcements table as well
    db.prepare('INSERT INTO announcements(campus_id,club_id,title,body,author_id,is_public,created_at) VALUES (?,?,?,?,?,1,?)')
      .run(c.campus_id, c.id, b.title, b.body, req.user.id, iso(ctx.now()));

    ctx.notify(ids, `${c.name}: ${b.title}`, b.body, `/clubs/${c.id}`);
    ctx.audit(req.user.id, 'club.announce', 'club', c.id, { neu: b });
    res.json({ sent_to: ids.length });
  });

  // =========================================================================
  // BUDGET & MULTI-TIER APPROVAL WORKFLOW
  // Workflow: Club Treasurer → Faculty Advisor → College Administration
  // Statuses:
  // - 'Draft'
  // - 'Submitted to Advisor'
  // - 'Advisor Changes Requested'
  // - 'Advisor Approved' / 'Sent to College'
  // - 'College Approved'
  // - 'College Rejected'
  // =========================================================================

  // Helper to normalize status for UI consistency
  const canonicalStatus = (st) => {
    if (st === 'pending_president' || st === 'pending') return 'Submitted to Advisor';
    if (st === 'pending_admin') return 'Sent to College';
    if (st === 'approved') return 'College Approved';
    if (st === 'rejected') return 'College Rejected';
    return st;
  };

  r.get('/budget', A, (req, res) => {
    const u = req.user;
    const filterCampusId = req.query.campus_id ? Number(req.query.campus_id) : null;
    let sql = `SELECT b.*, c.name club_name, c.campus_id, ca.name campus_name, u.name requester_name, u.email requester_email,
      adv.name advisor_name, dec.name decided_by_name
      FROM budget_requests b
      JOIN clubs c ON c.id=b.club_id
      JOIN campuses ca ON ca.id=c.campus_id
      JOIN users u ON u.id=b.requested_by
      LEFT JOIN users adv ON adv.id=c.advisor_id
      LEFT JOIN users dec ON dec.id=b.decided_by
      WHERE c.is_test=0`;
    const params = [];

    if (acc.isSuperAdmin(u)) {
      if (filterCampusId) {
        sql += ' AND c.campus_id=?';
        params.push(filterCampusId);
      }
    } else if (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') {
      sql += ' AND c.campus_id=?';
      params.push(u.campus_id);
    } else if (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') {
      sql += ` AND (c.advisor_id=? OR EXISTS (SELECT 1 FROM faculty_advisor_assignments fa WHERE fa.club_id=c.id AND fa.user_id=?))`;
      params.push(u.id, u.id);
    } else {
      // Student / Club Officer:
      const activeClubs = db.prepare("SELECT club_id, position FROM memberships WHERE user_id=? AND status='active'").all(u.id);
      const isTreasOrCoord = activeClubs.filter((m) => ['treasurer', 'president', 'vice_president'].includes(m.position)).map((m) => m.club_id);
      const memberClubIds = activeClubs.map((m) => m.club_id);

      if (isTreasOrCoord.length > 0) {
        // Treasurers/coordinators see their club's full budget pipeline
        sql += ` AND b.club_id IN (${isTreasOrCoord.join(',')})`;
      } else if (memberClubIds.length > 0) {
        // Regular members only see approved public budget summaries of their clubs
        sql += ` AND b.club_id IN (${memberClubIds.join(',')}) AND b.status IN ('College Approved','college_approved','approved')`;
      } else {
        return res.json({ items: [] });
      }
    }

    sql += ' ORDER BY b.id DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({
      items: rows.map((b) => ({
        ...b,
        normalized_status: canonicalStatus(b.status),
      })),
    });
  });

  // ---- Get budget approval timeline / audit trail ----
  r.get('/budget/:id/timeline', A, (req, res) => {
    const b = db.prepare('SELECT b.*, c.campus_id, c.name club_name FROM budget_requests b JOIN clubs c ON c.id=b.club_id WHERE b.id=?').get(req.params.id);
    if (!b) throw notFound('Budget request not found');
    const c = acc.club(b.club_id);
    acc.require(acc.canViewBudget(req.user, c), 'Access denied.');

    const timeline = db.prepare(`SELECT a.*, u.name actor_name, u.email actor_email, u.system_role actor_role
      FROM budget_approvals a
      JOIN users u ON u.id=a.actor_id
      WHERE a.budget_request_id=?
      ORDER BY a.id ASC`).all(b.id);

    res.json({
      budget_id: b.id,
      title: b.title,
      club_name: b.club_name,
      amount_inr: b.amount_inr,
      status: canonicalStatus(b.status),
      timeline,
    });
  });

  // ---- Create budget request (Club Treasurer, President, or Admin) ----
  r.post('/clubs/:id/budget', A, (req, res) => {
    const c = acc.club(req.params.id);
    const mem = acc.membership(req.user.id, c.id);
    const isTreas = mem?.position === 'treasurer';
    const isCoord = acc.isCoordinator(req.user, c.id);
    acc.require(acc.isSuperAdmin(req.user) || isTreas || isCoord, 'Only the club Treasurer, President, or Vice President can submit budget requests.');

    const b = parse(z.object({
      title: z.string().min(3).max(120),
      category: z.string().default('Equipment'),
      amount_inr: z.number().int().min(1).max(10000000),
      purpose: z.string().max(1000).optional(),
      items_json: z.string().max(10000).optional(),
      sheet_link: z.string().max(500).optional(),
      supporting_docs: z.string().max(1000).optional(),
      notes: z.string().max(1000).optional(),
      submit_now: z.boolean().default(true),
    }), req.body);

    const t = iso(ctx.now());
    let initialStatus = b.submit_now ? 'Submitted to Advisor' : 'Draft';
    if (acc.isSuperAdmin(req.user)) initialStatus = 'College Approved';

    const info = db.prepare(`INSERT INTO budget_requests(
      club_id, requested_by, title, category, amount_inr, purpose, items_json, sheet_link, supporting_docs, notes, status, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(c.id, req.user.id, b.title, b.category, b.amount_inr, b.purpose ?? null, b.items_json ?? null, b.sheet_link ?? null, b.supporting_docs ?? null, b.notes ?? null, initialStatus, t, t);

    const reqId = info.lastInsertRowid;

    // Record creation in budget_approvals timeline
    db.prepare('INSERT INTO budget_approvals(budget_request_id, actor_id, stage, action, notes, created_at) VALUES (?,?,?,?,?,?)')
      .run(reqId, req.user.id, 'treasurer', b.submit_now ? 'submit' : 'draft', b.notes || (b.submit_now ? 'Submitted for advisor review' : 'Saved as draft'), t);

    // Notify Advisor if submitted
    if (b.submit_now && c.advisor_id) {
      ctx.notify([c.advisor_id], `New budget request: ${b.title}`, `${c.name} Treasurer requested ₹${b.amount_inr.toLocaleString('en-IN')} for review.`, '/budget');
    }

    ctx.audit(req.user.id, 'budget.create', 'budget', reqId, { neu: { title: b.title, amount: b.amount_inr, status: initialStatus } });
    res.status(201).json({ id: reqId, status: initialStatus });
  });

  // ---- Update / Revise budget request (when in Draft or Changes Requested) ----
  r.patch('/budget/:id', A, (req, res) => {
    const br = db.prepare('SELECT * FROM budget_requests WHERE id=?').get(req.params.id);
    if (!br) throw notFound('Budget request not found');
    const c = acc.club(br.club_id);
    const mem = acc.membership(req.user.id, c.id);
    const isTreas = mem?.position === 'treasurer' || br.requested_by === req.user.id;
    acc.require(acc.isSuperAdmin(req.user) || isTreas, 'Permission denied.');

    const b = parse(z.object({
      title: z.string().min(3).max(120).optional(),
      category: z.string().optional(),
      amount_inr: z.number().int().min(1).max(10000000).optional(),
      purpose: z.string().max(1000).optional(),
      items_json: z.string().max(10000).optional(),
      sheet_link: z.string().max(500).optional(),
      supporting_docs: z.string().max(1000).optional(),
      notes: z.string().max(1000).optional(),
      submit_now: z.boolean().optional(),
    }), req.body);

    const t = iso(ctx.now());
    let nextStatus = br.status;
    if (b.submit_now) {
      nextStatus = 'Submitted to Advisor';
    }

    db.prepare(`UPDATE budget_requests SET
      title = COALESCE(?, title),
      category = COALESCE(?, category),
      amount_inr = COALESCE(?, amount_inr),
      purpose = COALESCE(?, purpose),
      items_json = COALESCE(?, items_json),
      sheet_link = COALESCE(?, sheet_link),
      supporting_docs = COALESCE(?, supporting_docs),
      notes = COALESCE(?, notes),
      status = ?,
      updated_at = ?
      WHERE id = ?`)
      .run(b.title ?? null, b.category ?? null, b.amount_inr ?? null, b.purpose ?? null, b.items_json ?? null, b.sheet_link ?? null, b.supporting_docs ?? null, b.notes ?? null, nextStatus, t, br.id);

    if (b.submit_now) {
      db.prepare('INSERT INTO budget_approvals(budget_request_id, actor_id, stage, action, notes, created_at) VALUES (?,?,?,?,?,?)')
        .run(br.id, req.user.id, 'treasurer', 'resubmit', b.notes || 'Re-submitted with requested revisions', t);
      if (c.advisor_id) {
        ctx.notify([c.advisor_id], `Revised budget request: ${br.title}`, `Re-submitted for ${c.name}. Please review.`, '/budget');
      }
    }

    res.json({ ok: true, status: nextStatus });
  });

  // ---- Faculty Advisor Decision (Approve & Forward, Request Changes, Reject) ----
  r.post('/budget/:id/advisor-decision', A, (req, res) => {
    const br = db.prepare('SELECT * FROM budget_requests WHERE id=?').get(req.params.id);
    if (!br) throw notFound('Budget request not found');
    const c = acc.club(br.club_id);
    acc.require(acc.canAdvisorApproveBudget(req.user, c), 'Only the Faculty Advisor (or Admin) can review this budget request.');

    const { action, notes } = parse(z.object({
      action: z.enum(['approve', 'request_changes', 'reject']),
      notes: z.string().max(1000).optional(),
    }), req.body);

    const t = iso(ctx.now());
    let nextStatus;
    let auditAction;

    if (action === 'approve') {
      // Forward to College Administration
      nextStatus = 'Sent to College';
      auditAction = 'advisor_approve';
      db.prepare('UPDATE budget_requests SET status=?, advisor_feedback=?, president_decided_by=?, president_decided_at=?, updated_at=? WHERE id=?')
        .run(nextStatus, notes ?? 'Advisor approved and forwarded to College Admin', req.user.id, t, t, br.id);

      // Notify College Admins (Campus Admin for that campus & Super Admin)
      const collegeAdmins = db.prepare("SELECT id FROM users WHERE system_role IN ('super_admin','admin') OR (system_role IN ('campus_admin','campus_manager') AND campus_id=?)").all(c.campus_id).map((x) => x.id);
      ctx.notify(collegeAdmins, `Budget awaiting College approval: ${br.title}`, `${c.name} (₹${br.amount_inr.toLocaleString('en-IN')}) approved by Advisor ${req.user.name}.`, '/budget');
      ctx.notify([br.requested_by], `Budget Approved by Advisor: ${br.title}`, 'Forwarded to College Administration for final review.', '/budget');
    } else if (action === 'request_changes') {
      nextStatus = 'Advisor Changes Requested';
      auditAction = 'advisor_request_changes';
      db.prepare('UPDATE budget_requests SET status=?, advisor_feedback=?, updated_at=? WHERE id=?')
        .run(nextStatus, notes ?? 'Changes requested by advisor', t, br.id);
      ctx.notify([br.requested_by], `Changes Requested: ${br.title}`, notes || 'Your Faculty Advisor requested revisions on your budget proposal.', '/budget');
    } else {
      nextStatus = 'College Rejected';
      auditAction = 'advisor_reject';
      db.prepare('UPDATE budget_requests SET status=?, advisor_feedback=?, updated_at=? WHERE id=?')
        .run(nextStatus, notes ?? 'Rejected by advisor', t, br.id);
      ctx.notify([br.requested_by], `Budget Request Rejected: ${br.title}`, notes || 'Advisor did not approve this request.', '/budget');
    }

    db.prepare('INSERT INTO budget_approvals(budget_request_id, actor_id, stage, action, notes, created_at) VALUES (?,?,?,?,?,?)')
      .run(br.id, req.user.id, 'faculty_advisor', action, notes ?? null, t);

    ctx.audit(req.user.id, `budget.${auditAction}`, 'budget', br.id, { reason: notes, status: nextStatus });
    res.json({ ok: true, status: nextStatus });
  });

  // ---- College Administration Final Decision (Approve, Reject) ----
  r.post('/budget/:id/college-decision', A, (req, res) => {
    const br = db.prepare('SELECT * FROM budget_requests WHERE id=?').get(req.params.id);
    if (!br) throw notFound('Budget request not found');
    const c = acc.club(br.club_id);
    acc.require(acc.canCollegeApproveBudget(req.user, c), 'Only College Administration (Campus Admin or Super Admin) can give final budget approval.');

    const { action, notes } = parse(z.object({
      action: z.enum(['approve', 'reject']),
      notes: z.string().max(1000).optional(),
    }), req.body);

    const t = iso(ctx.now());
    const nextStatus = action === 'approve' ? 'College Approved' : 'College Rejected';

    db.prepare('UPDATE budget_requests SET status=?, college_feedback=?, decided_by=?, decided_at=?, updated_at=? WHERE id=?')
      .run(nextStatus, notes ?? null, req.user.id, t, t, br.id);

    db.prepare('INSERT INTO budget_approvals(budget_request_id, actor_id, stage, action, notes, created_at) VALUES (?,?,?,?,?,?)')
      .run(br.id, req.user.id, 'college_admin', action, notes ?? null, t);

    // Notify Treasurer and Advisor
    const recipients = [br.requested_by, c.advisor_id].filter(Boolean);
    ctx.notify(recipients, `Final College Decision: ${br.title}`, `${action === 'approve' ? 'Approved & funded' : 'Rejected'}. ${notes || ''}`, '/budget');

    ctx.audit(req.user.id, `budget.college_${action}`, 'budget', br.id, { reason: notes, status: nextStatus });
    res.json({ ok: true, status: nextStatus });
  });

  // ---- Legacy decision route for backward compatibility ----
  r.post('/budget/:id/decision', A, (req, res) => {
    const br = db.prepare('SELECT * FROM budget_requests WHERE id=?').get(req.params.id);
    if (!br) throw notFound('Budget request not found');
    const c = acc.club(br.club_id);
    const { approve, note } = parse(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req.body);
    const action = approve ? 'approve' : 'reject';

    // Route to advisor or college based on current status and user role
    if (br.status === 'Submitted to Advisor' || br.status === 'pending_president' || br.status === 'pending') {
      if (acc.canAdvisorApproveBudget(req.user, c)) {
        req.body = { action, notes: note };
        return r.handle({ ...req, url: `/budget/${br.id}/advisor-decision` }, res);
      }
    }
    req.body = { action, notes: note };
    return r.handle({ ...req, url: `/budget/${br.id}/college-decision` }, res);
  });

  return r;
}
