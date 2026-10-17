import crypto from 'node:crypto';

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// All figures are derived from the raw attendance / submission / evaluation tables.
// attendance_pct = attended check-ins / (sessions held x current active members)
export function clubStats(db, clubId, from, to) {
  const members = db.prepare("SELECT COUNT(*) n FROM memberships WHERE club_id=? AND status='active'").get(clubId).n;
  const sessions = db.prepare(`SELECT s.id session_id, a.id activity_id, a.topic, a.format, cd.date
    FROM sessions s JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id
    WHERE s.club_id=? AND s.kind='club_day' AND cd.date BETWEEN ? AND ? ORDER BY cd.date`).all(clubId, from, to);
  const qAtt = db.prepare("SELECT COUNT(*) n FROM attendance WHERE session_id=? AND status IN ('present','late')");
  const qLate = db.prepare("SELECT COUNT(*) n FROM attendance WHERE session_id=? AND status='late'");
  const qSub = db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?');
  const qAvg = db.prepare('SELECT AVG(e.total) v FROM evaluations e JOIN submissions s ON s.id=e.submission_id WHERE s.activity_id=? AND e.published=1');
  let attended = 0, submissions = 0, expectedSubs = 0;
  const rows = sessions.map((s) => {
    const att = qAtt.get(s.session_id).n, sub = qSub.get(s.activity_id).n, avg = qAvg.get(s.activity_id).v;
    attended += att; submissions += sub;
    if (s.format !== 'on_the_spot') expectedSubs += members;
    return { date: s.date, topic: s.topic, format: s.format, activity_id: s.activity_id, members, attended: att, late: qLate.get(s.session_id).n,
      attendance_pct: members ? r1((att / members) * 100) : 0, submissions: sub, avg_score: avg == null ? null : r2(avg) };
  });
  const avgAll = db.prepare(`SELECT AVG(e.total) v FROM evaluations e JOIN submissions s ON s.id=e.submission_id
    JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id
    WHERE a.club_id=? AND e.published=1 AND cd.date BETWEEN ? AND ?`).get(clubId, from, to).v;
  const last = db.prepare(`SELECT MAX(cd.date) d FROM sessions s JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id
    WHERE s.club_id=? AND s.kind='club_day'`).get(clubId).d;
  return {
    club_id: clubId, members, held: sessions.length, attended, submissions,
    attendance_pct: sessions.length && members ? r1((attended / (sessions.length * members)) * 100) : 0,
    submission_rate: expectedSubs ? r1((submissions / expectedSubs) * 100) : 0,
    avg_score: avgAll == null ? null : r2(avgAll), last_session_date: last, sessions: rows,
  };
}

export function monthRange(month) { // 'YYYY-MM' -> [from,to]
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

export function monthlyReport(db, clubId, month) {
  const [from, to] = monthRange(month);
  const club = db.prepare('SELECT c.name, c.campus_id, u.name advisor FROM clubs c LEFT JOIN users u ON u.id=c.advisor_id WHERE c.id=?').get(clubId);
  const s = clubStats(db, clubId, from, to);
  const best = db.prepare(`SELECT u.name, ROUND(AVG(e.total),2) avg FROM evaluations e JOIN submissions su ON su.id=e.submission_id
    JOIN users u ON u.id=su.user_id JOIN activities a ON a.id=su.activity_id JOIN club_days cd ON cd.id=a.club_day_id
    WHERE a.club_id=? AND e.published=1 AND cd.date BETWEEN ? AND ? GROUP BY u.id ORDER BY avg DESC, u.name LIMIT 3`).all(clubId, from, to);
  const perfect = s.held ? db.prepare(`SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.club_id=? AND m.status='active' AND (SELECT COUNT(*) FROM attendance at JOIN sessions se ON se.id=at.session_id
      JOIN activities a ON a.id=se.activity_id JOIN club_days cd ON cd.id=a.club_day_id
      WHERE se.club_id=m.club_id AND at.user_id=m.user_id AND at.status IN ('present','late') AND cd.date BETWEEN ? AND ?) = ? ORDER BY u.name`).all(clubId, from, to, s.held).map((r) => r.name) : [];
  const certs = db.prepare(`SELECT COUNT(*) n FROM certificates WHERE club_id=? AND kind!='transcript' AND substr(issued_at,1,7)=?`).get(clubId, month).n;
  return { month, club: { id: clubId, name: club.name, advisor: club.advisor }, ...s,
    highlights: { top_scorers: best, perfect_attendance: perfect, certificates_issued: certs } };
}

const inList = (ids) => (ids.length ? ids.join(',') : 'NULL');

export function overview(db, { clubIds, campusId, wide, inactiveDays, todayMs }) {
  const today = new Date(todayMs).toISOString().slice(0, 10);
  const from = '0000-01-01', to = '9999-12-31';
  const clubs = db.prepare(`SELECT c.id, c.name, c.campus_id, ca.name campus, u.name advisor FROM clubs c
    JOIN campuses ca ON ca.id=c.campus_id LEFT JOIN users u ON u.id=c.advisor_id WHERE c.id IN (${inList(clubIds)}) ORDER BY c.name`).all();
  const per = clubs.map((c) => {
    const st = clubStats(db, c.id, from, to);
    const cutoff = new Date(todayMs - inactiveDays * 86400000).toISOString().slice(0, 10);
    return { ...c, members: st.members, held: st.held, attendance_pct: st.attendance_pct, submissions: st.submissions,
      submission_rate: st.submission_rate, avg_score: st.avg_score, last_session_date: st.last_session_date,
      inactive: !st.last_session_date || st.last_session_date < cutoff };
  });
  const byCampus = {};
  for (const c of per) {
    const b = (byCampus[c.campus] ||= { campus: c.campus, clubs: 0, members: 0, attended: 0, expected: 0, submissions: 0 });
    b.clubs++; b.members += c.members; b.submissions += c.submissions;
    b.attended += Math.round((c.attendance_pct / 100) * c.held * c.members); b.expected += c.held * c.members;
  }
  const campuses = Object.values(byCampus).map((b) => ({ campus: b.campus, clubs: b.clubs, members: b.members, submissions: b.submissions,
    attendance_pct: b.expected ? r1((b.attended / b.expected) * 100) : 0 }));

  // students in scope
  const scope = wide
    ? db.prepare(`SELECT u.id, u.name, u.student_code FROM users u WHERE u.system_role='student' AND u.is_test=0 ${campusId ? 'AND u.campus_id=' + Number(campusId) : ''}`).all()
    : db.prepare(`SELECT DISTINCT u.id, u.name, u.student_code FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.status='active' AND m.club_id IN (${inList(clubIds)}) AND u.is_test=0`).all();
  const cf = wide ? '' : `AND s.club_id IN (${inList(clubIds)})`;
  const att = new Map(db.prepare(`SELECT at.user_id uid, COUNT(*) n FROM attendance at JOIN sessions s ON s.id=at.session_id
    WHERE at.status IN ('present','late') ${cf} GROUP BY at.user_id`).all().map((r) => [r.uid, r.n]));
  const sub = new Map(db.prepare(`SELECT su.user_id uid, COUNT(*) n FROM submissions su JOIN activities a ON a.id=su.activity_id
    WHERE 1=1 ${wide ? '' : `AND a.club_id IN (${inList(clubIds)})`} GROUP BY su.user_id`).all().map((r) => [r.uid, r.n]));
  const evs = wide ? new Map(db.prepare('SELECT user_id uid, COUNT(*) n FROM event_regs GROUP BY user_id').all().map((r) => [r.uid, r.n])) : new Map();
  const people = scope.map((p) => {
    const a = att.get(p.id) || 0, s = sub.get(p.id) || 0, e = evs.get(p.id) || 0;
    return { ...p, attended: a, submissions: s, events: e, points: a + 2 * s + 3 * e };
  });
  const zero = people.filter((p) => !p.attended && !p.submissions && !p.events).map(({ id, name, student_code }) => ({ id, name, student_code }));
  const top = people.filter((p) => p.points > 0).sort((x, y) => y.points - x.points || x.name.localeCompare(y.name)).slice(0, 10);

  const trend = db.prepare(`SELECT cd.date, COUNT(DISTINCT s.club_id) clubs_held,
      (SELECT COUNT(*) FROM attendance at JOIN sessions s2 ON s2.id=at.session_id JOIN activities a2 ON a2.id=s2.activity_id JOIN club_days cd2 ON cd2.id=a2.club_day_id
        WHERE cd2.date=cd.date AND at.status IN ('present','late') AND s2.club_id IN (${inList(clubIds)})) attended
    FROM sessions s JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id
    WHERE s.kind='club_day' AND s.club_id IN (${inList(clubIds)}) GROUP BY cd.date ORDER BY cd.date`).all()
    .map((t) => {
      const exp = db.prepare(`SELECT COALESCE(SUM((SELECT COUNT(*) FROM memberships m WHERE m.club_id=s.club_id AND m.status='active')),0) n
        FROM sessions s JOIN activities a ON a.id=s.activity_id JOIN club_days cd ON cd.id=a.club_day_id WHERE cd.date=? AND s.club_id IN (${inList(clubIds)})`).get(t.date).n;
      return { date: t.date, attended: t.attended, expected: exp, attendance_pct: exp ? r1((t.attended / exp) * 100) : 0 };
    });
  const totals = {
    clubs: per.length, students: people.length, active_members: db.prepare(`SELECT COUNT(DISTINCT user_id) n FROM memberships WHERE status='active' AND club_id IN (${inList(clubIds)})`).get().n,
    inactive_clubs: per.filter((c) => c.inactive).length, zero_participation: zero.length, today,
  };
  return { totals, clubs: per, campuses, inactive_clubs: per.filter((c) => c.inactive), zero_participation: zero.slice(0, 200), top_contributors: top, trend };
}

export function buildTranscript(ctx, userId) {
  const { db, now } = ctx;
  const student = db.prepare(`SELECT u.id, u.name, u.student_code, ca.name campus FROM users u LEFT JOIN campuses ca ON ca.id=u.campus_id WHERE u.id=?`).get(userId);
  const clubs = db.prepare(`SELECT c.id, c.name club, m.position FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=? AND m.status='active' ORDER BY m.is_primary DESC, c.name`).all(userId).map((c) => {
    const sessions = db.prepare("SELECT COUNT(*) n FROM sessions WHERE club_id=? AND kind='club_day'").get(c.id).n;
    const attended = db.prepare(`SELECT COUNT(*) n FROM attendance at JOIN sessions s ON s.id=at.session_id WHERE s.club_id=? AND at.user_id=? AND at.status IN ('present','late')`).get(c.id, userId).n;
    const subs = db.prepare('SELECT COUNT(*) n FROM submissions su JOIN activities a ON a.id=su.activity_id WHERE a.club_id=? AND su.user_id=?').get(c.id, userId).n;
    const avg = db.prepare(`SELECT AVG(e.total) v FROM evaluations e JOIN submissions su ON su.id=e.submission_id JOIN activities a ON a.id=su.activity_id
      WHERE a.club_id=? AND su.user_id=? AND e.published=1`).get(c.id, userId).v;
    return { club: c.club, position: c.position, sessions, attended, attendance_pct: sessions ? Math.round((attended / sessions) * 100) : 0, submissions: subs, avg_score: avg == null ? null : r2(avg) };
  });
  const events = db.prepare(`SELECT e.name, substr(e.starts_at,1,10) date, t.name team, r.result_position position FROM event_regs r JOIN events e ON e.id=r.event_id
    LEFT JOIN teams t ON t.id=r.team_id WHERE r.user_id=? AND e.is_test=0 ORDER BY e.starts_at`).all(userId);
  const certificates = db.prepare("SELECT id, title, kind, substr(issued_at,1,10) issued_at, status FROM certificates WHERE user_id=? AND kind!='transcript' ORDER BY issued_at, id").all(userId);
  const summary = {
    clubs: clubs.length, attended: clubs.reduce((a, c) => a + c.attended, 0), submissions: clubs.reduce((a, c) => a + c.submissions, 0),
    avg_score: (() => { const v = clubs.filter((c) => c.avg_score != null); return v.length ? r2(v.reduce((a, c) => a + c.avg_score, 0) / v.length) : null; })(),
    certificates: certificates.filter((c) => c.status === 'valid').length,
  };
  const core = { student, clubs, events, certificates, summary };
  const dataHash = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 32);
  return { ...core, dataHash, generatedAt: new Date(now()).toISOString() };
}
