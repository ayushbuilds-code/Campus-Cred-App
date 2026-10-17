import crypto from 'node:crypto';
import { iso, conflict, bad } from './util.js';

// Opens (or re-opens) the one check-in session an activity / event can have.
export function openSession(ctx, { activity, event, user, windowMin, lateMin, geoMode }) {
  const { db, now } = ctx;
  const t = now();
  const window = windowMin ?? ctx.setting('checkin_window_minutes');
  const late = lateMin ?? ctx.setting('late_after_minutes');
  const mode = geoMode ?? ctx.setting('geo_mode');
  if (!(window > 0 && window <= 24 * 60)) throw bad('window_minutes must be between 1 and 1440');
  if (!(late >= 0 && late <= window)) throw bad('late_after_minutes must be between 0 and the check-in window');
  const closes = iso(t + window * 60000), lateAfter = iso(t + late * 60000);
  const existing = activity
    ? db.prepare('SELECT * FROM sessions WHERE activity_id=?').get(activity.id)
    : db.prepare('SELECT * FROM sessions WHERE event_id=?').get(event.id);
  if (existing) {
    if (existing.status === 'open' && new Date(existing.closes_at).getTime() > t) return { session: existing, fresh: false };
    db.prepare("UPDATE sessions SET status='open', closes_at=?, late_after=? WHERE id=?").run(closes, lateAfter, existing.id);
    return { session: db.prepare('SELECT * FROM sessions WHERE id=?').get(existing.id), fresh: true };
  }
  const campusId = activity ? db.prepare('SELECT campus_id FROM clubs WHERE id=?').get(activity.club_id).campus_id : (event.campus_id ?? user.campus_id);
  const campus = db.prepare('SELECT lat,lng,radius_m FROM campuses WHERE id=?').get(campusId);
  const info = db.prepare(`INSERT INTO sessions(kind,activity_id,event_id,club_id,opened_by,opened_at,closes_at,late_after,status,secret,geo_lat,geo_lng,geo_radius_m,geo_mode)
    VALUES (?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`).run(
    activity ? 'club_day' : 'event', activity?.id ?? null, event?.id ?? null, activity?.club_id ?? null, user.id,
    iso(t), closes, lateAfter, crypto.randomBytes(24).toString('hex'),
    campus?.lat ?? null, campus?.lng ?? null, campus?.radius_m ?? null, campus?.lat == null ? 'off' : mode);
  return { session: db.prepare('SELECT * FROM sessions WHERE id=?').get(info.lastInsertRowid), fresh: true };
}

export function sessionAttendance(db, session) {
  // roster: club members (club day) or registered participants (event) + their check-in state
  const roster = session.kind === 'club_day'
    ? db.prepare(`SELECT u.id user_id, u.name, u.student_code, m.position FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.club_id=? AND m.status='active' ORDER BY CASE m.position WHEN 'president' THEN 0 WHEN 'vice_president' THEN 1 WHEN 'treasurer' THEN 2 ELSE 3 END, u.name`).all(session.club_id)
    : db.prepare(`SELECT u.id user_id, u.name, u.student_code, 'participant' position FROM event_regs r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY u.name`).all(session.event_id);
  const att = new Map(db.prepare('SELECT * FROM attendance WHERE session_id=?').all(session.id).map((a) => [a.user_id, a]));
  return roster.map((p) => {
    const a = att.get(p.user_id);
    return { ...p, status: a?.status ?? 'absent', checked_in: !!a, checked_at: a?.checked_at ?? null, method: a?.method ?? null,
      flag: a?.flag ?? null, distance_m: a?.distance_m ?? null, correction_reason: a?.correction_reason ?? null };
  });
}
export { conflict };
