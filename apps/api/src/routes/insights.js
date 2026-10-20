import { Router } from 'express';
import { z, parse, toCsv, bad, forbidden } from '../lib/util.js';
import { overview, monthlyReport, clubStats } from '../lib/stats.js';
import { generateMonthlyReports, runScheduler } from '../lib/jobs.js';

export default function insightRoutes(ctx) {
  const r = Router();
  const { db, access: acc } = ctx;
  const A = ctx.auth;
  const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;

  const isSuper = (u) => u.system_role === 'super_admin' || u.system_role === 'admin';
  const isCampus = (u) => u.system_role === 'campus_admin' || u.system_role === 'campus_manager';
  const isAdv = (u) => u.system_role === 'faculty_advisor' || u.system_role === 'advisor';

  const scope = (u, campusParam) => {
    const clubIds = acc.visibleClubIds(u, campusParam);
    const wide = isSuper(u) || isCampus(u);
    // Only throw for students/coordinators with no clubs — advisors and wide roles always get a dashboard
    if (!wide && !isAdv(u) && !clubIds.length) throw forbidden('Dashboards are for coordinators, advisors, campus managers and admins.');
    const campusId = isCampus(u) ? u.campus_id : campusParam ? Number(campusParam) : null;
    const ids = campusId ? clubIds.filter((id) => { const row = db.prepare('SELECT campus_id FROM clubs WHERE id=?').get(id); return row && row.campus_id === campusId; }) : clubIds;
    return { ids, wide, campusId };
  };

  r.get('/insights/overview', A, (req, res) => {
    const { ids, wide, campusId } = scope(req.user, req.query.campus_id);
    res.json({ scope: wide ? 'campus' : 'club', ...overview(db, { clubIds: ids, campusId, wide, inactiveDays: ctx.setting('inactive_days'), todayMs: ctx.now() }) });
  });

  r.get('/reports/monthly', A, (req, res) => {
    const month = String(req.query.month || '');
    if (!monthRe.test(month)) throw bad('month must look like 2026-10');
    const { ids } = scope(req.user, req.query.campus_id);
    const club = req.query.club_id ? Number(req.query.club_id) : null;
    if (club && !ids.includes(club)) throw forbidden();
    res.json({ month, reports: (club ? [club] : ids).map((id) => monthlyReport(db, id, month)) });
  });

  r.post('/reports/monthly/generate', A, ctx.roles('admin', 'campus_manager'), (req, res) => {
    const { month } = parse(z.object({ month: z.string().regex(monthRe) }), req.body);
    const n = generateMonthlyReports(ctx, month);
    ctx.audit(req.user.id, 'report.generate', 'report', month, { neu: { clubs: n } });
    res.json({ clubs: n });
  });

  r.get('/reports/monthly.csv', A, (req, res) => {
    const month = String(req.query.month || '');
    if (!monthRe.test(month)) throw bad('month must look like 2026-10');
    const { ids } = scope(req.user, req.query.campus_id);
    const rows = ids.map((id) => { const m = monthlyReport(db, id, month); return { club: m.club.name, month, club_days_held: m.held, members: m.members, check_ins: m.attended,
      attendance_pct: m.attendance_pct, submissions: m.submissions, submission_rate_pct: m.submission_rate, avg_score: m.avg_score ?? '' }; });
    res.type('text/csv').attachment(`club-report-${month}.csv`).send(toCsv(rows, ['club', 'month', 'club_days_held', 'members', 'check_ins', 'attendance_pct', 'submissions', 'submission_rate_pct', 'avg_score']));
  });

  r.get('/insights/participation.csv', A, ctx.roles('admin', 'campus_manager'), (req, res) => {
    const campus = req.user.system_role === 'campus_manager' ? req.user.campus_id : null;
    const rows = db.prepare(`SELECT u.student_code, u.name,
      (SELECT group_concat(c.name || ' (' || m.position || ')', '; ') FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=u.id AND m.status='active') clubs,
      (SELECT COUNT(*) FROM attendance a WHERE a.user_id=u.id AND a.status IN ('present','late')) sessions_attended,
      (SELECT COUNT(*) FROM submissions s WHERE s.user_id=u.id) submissions,
      (SELECT COUNT(*) FROM event_regs r WHERE r.user_id=u.id) events,
      (SELECT COUNT(*) FROM certificates c WHERE c.user_id=u.id AND c.status='valid' AND c.kind!='transcript') certificates,
      (SELECT ROUND(AVG(e.total),2) FROM evaluations e JOIN submissions s ON s.id=e.submission_id WHERE s.user_id=u.id AND e.published=1) avg_score
      FROM users u WHERE u.system_role='student' AND u.is_test=0 AND (? IS NULL OR u.campus_id=?) ORDER BY u.name`).all(campus, campus);
    res.type('text/csv').attachment('participation-by-student.csv').send(toCsv(rows, ['student_code', 'name', 'clubs', 'sessions_attended', 'submissions', 'events', 'certificates', 'avg_score']));
  });

  // Admin can trigger the scheduled jobs manually (they also run every minute).
  r.post('/admin/run-jobs', A, ctx.roles('admin'), (req, res) => res.json(runScheduler(ctx)));
  void clubStats;
  return r;
}
