import { iso } from './util.js';
import { monthlyReport } from './stats.js';

const sent = (db, key) => !!db.prepare('SELECT 1 FROM reminders WHERE key=?').get(key);
const mark = (db, key, ctx) => db.prepare('INSERT OR IGNORE INTO reminders(key,sent_at) VALUES (?,?)').run(key, iso(ctx.now()));
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDeadline = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'no deadline');

// "3 days before: members are notified with topic, venue, deliverable and deadline"
export function announceActivity(ctx, activityId) {
  const { db } = ctx;
  const key = `announce:${activityId}`;
  if (sent(db, key)) return false;
  const a = db.prepare(`SELECT a.*, cd.date, cd.venue day_venue, c.name club_name FROM activities a JOIN club_days cd ON cd.id=a.club_day_id JOIN clubs c ON c.id=a.club_id WHERE a.id=?`).get(activityId);
  if (!a || a.status !== 'approved') return false;
  const members = db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active'").all(a.club_id).map((m) => m.user_id);
  const what = a.format === 'on_the_spot' ? 'On-the-spot activity (nothing to submit)' : `Deliverable: ${a.deliverable || a.format}. Submit by ${fmtDeadline(a.submission_deadline)}`;
  ctx.notify(members, `${a.club_name} Club Day, ${fmtDay(a.date)}: ${a.topic}`, `Venue: ${a.venue || a.day_venue || 'to be announced'}. ${what}.`, `/activities/${a.id}`);
  mark(db, key, ctx);
  return true;
}

export function generateMonthlyReports(ctx, month) {
  const { db } = ctx;
  const clubs = db.prepare("SELECT id, campus_id, name, advisor_id FROM clubs WHERE status='approved' AND is_test=0").all();
  const up = db.prepare(`INSERT INTO monthly_reports(club_id,month,payload,generated_at) VALUES (?,?,?,?)
    ON CONFLICT(club_id,month) DO UPDATE SET payload=excluded.payload, generated_at=excluded.generated_at`);
  for (const c of clubs) {
    const rep = monthlyReport(db, c.id, month);
    up.run(c.id, month, JSON.stringify(rep), iso(ctx.now()));
    const cms = db.prepare("SELECT id FROM users WHERE system_role='campus_manager' AND campus_id=?").all(c.campus_id).map((x) => x.id);
    ctx.notify(cms, `${c.name}: ${month} report is ready`,
      `${rep.held} Club Day(s), attendance ${rep.attendance_pct}%, ${rep.submissions} submissions, average score ${rep.avg_score ?? 'n/a'}.`, `/reports?month=${month}&club=${c.id}`);
  }
  return clubs.length;
}

export function runScheduler(ctx) {
  const { db } = ctx;
  const nowMs = ctx.now(), nowIso = iso(nowMs), today = nowIso.slice(0, 10);
  const plus = (days) => iso(nowMs + days * 86400000).slice(0, 10);
  const out = { announced: 0, plan_reminders: 0, submission_reminders: 0, reports: 0 };

  for (const a of db.prepare(`SELECT a.id FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.status='approved' AND cd.date BETWEEN ? AND ?`).all(today, plus(3))) {
    if (announceActivity(ctx, a.id)) out.announced++;
  }
  // 7 days before: plan due
  const due = db.prepare(`SELECT c.id club_id, c.name, cd.id day_id, cd.date, a.status FROM clubs c JOIN club_days cd ON cd.campus_id=c.campus_id
    LEFT JOIN activities a ON a.club_id=c.id AND a.club_day_id=cd.id
    WHERE c.status='approved' AND c.is_test=0 AND cd.date BETWEEN ? AND ? AND (a.id IS NULL OR a.status IN ('draft','changes_requested'))`).all(today, plus(7));
  for (const d of due) {
    const key = `plan:${d.club_id}:${d.day_id}`;
    if (sent(db, key)) continue;
    const coords = db.prepare("SELECT user_id FROM memberships WHERE club_id=? AND status='active' AND position IN ('president','vice_president')").all(d.club_id).map((x) => x.user_id);
    ctx.notify(coords, `Plan your ${fmtDay(d.date)} Club Day`, `${d.name} has no submitted activity plan yet. Plans are due 7 days before the Club Day.`, '/club-days');
    mark(db, key, ctx); out.plan_reminders++;
  }
  // 24h before the deadline: remind attendees who have not submitted
  const subs = db.prepare(`SELECT a.id, a.topic, a.submission_deadline, a.club_id FROM activities a WHERE a.status='approved' AND a.format!='on_the_spot'
    AND a.submission_deadline>? AND a.submission_deadline<=? AND EXISTS (SELECT 1 FROM sessions s WHERE s.activity_id=a.id)`).all(nowIso, iso(nowMs + 86400000));
  for (const a of subs) {
    const key = `sub24:${a.id}`;
    if (sent(db, key)) continue;
    const who = db.prepare(`SELECT m.user_id FROM memberships m WHERE m.club_id=? AND m.status='active'
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.activity_id=? AND s.user_id=m.user_id)`).all(a.club_id, a.id).map((x) => x.user_id);
    ctx.notify(who, `Reminder: submit "${a.topic}"`, `The deadline is ${fmtDeadline(a.submission_deadline)}.`, `/activities/${a.id}`);
    mark(db, key, ctx); out.submission_reminders++;
  }
  // end of month report (last day of the month, plus catch-up for the previous month)
  const month = today.slice(0, 7), tomorrowMonth = plus(1).slice(0, 7);
  const prev = iso(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).slice(0, 7);
  for (const m of [tomorrowMonth !== month ? month : null, prev].filter(Boolean)) {
    const key = `report:${m}`;
    const hasData = db.prepare("SELECT 1 FROM sessions s JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id WHERE substr(cd.date,1,7)=? LIMIT 1").get(m);
    if (!sent(db, key) && hasData) { generateMonthlyReports(ctx, m); mark(db, key, ctx); out.reports++; }
  }
  return out;
}
