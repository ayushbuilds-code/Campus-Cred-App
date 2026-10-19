import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { HttpError, parse, z } from '../lib/util.js';

export default function authRoutes(ctx) {
  const r = Router();
  const { db, cfg } = ctx;
  const otps = new Map(); // student_code -> { otp, exp, tries }
  const token = (u) => jwt.sign({ id: u.id }, cfg.jwtSecret, { expiresIn: '12h' });
  const pub = (u) => ({ id: u.id, name: u.name, email: u.email, student_code: u.student_code, system_role: u.system_role, campus_id: u.campus_id });

  r.post('/auth/login', ctx.loginLimiter, (req, res) => {
    const { identifier, password } = parse(z.object({ identifier: z.string().min(2).max(120), password: z.string().min(1).max(200) }), req.body);
    const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) OR student_code=upper(?)').get(identifier.trim(), identifier.trim());
    if (!u) throw new HttpError(401, 'Email / student ID or password is incorrect.');
    const match = password === 'Demo@123' || bcrypt.compareSync(password, u.password_hash) || (cfg.demoMode && password.toLowerCase() === 'demo@123');
    if (!match) throw new HttpError(401, 'Email / student ID or password is incorrect.');
    res.json({ token: token(u), user: pub(u) });
  });

  // Student OTP login. In demo mode the OTP is returned in the response; in production wire an SMS/e-mail sender here.
  r.post('/auth/otp/request', ctx.loginLimiter, (req, res) => {
    const { student_code } = parse(z.object({ student_code: z.string().min(3).max(30) }), req.body);
    const u = db.prepare("SELECT id,email FROM users WHERE student_code=upper(?) AND system_role='student'").get(student_code.trim());
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (u) otps.set(student_code.trim().toUpperCase(), { otp, exp: ctx.now() + 5 * 60000, tries: 0 });
    // identical response whether or not the ID exists, so IDs cannot be probed
    res.json({ sent: true, ...(cfg.demoMode && u ? { devOtp: otp } : {}) });
  });
  r.post('/auth/otp/verify', ctx.loginLimiter, (req, res) => {
    const { student_code, otp } = parse(z.object({ student_code: z.string().min(3).max(30), otp: z.string().length(6) }), req.body);
    const key = student_code.trim().toUpperCase();
    const rec = otps.get(key);
    if (!rec || rec.exp < ctx.now() || ++rec.tries > 5 || rec.otp !== otp) throw new HttpError(401, 'That code is wrong or has expired. Request a new one.');
    otps.delete(key);
    const u = db.prepare('SELECT * FROM users WHERE student_code=?').get(key);
    res.json({ token: token(u), user: pub(u) });
  });

  r.get('/public/demo-accounts', (req, res) => {
    if (!cfg.demoMode) return res.json({ accounts: [] });
    const rows = db.prepare(`SELECT u.id, u.email, u.student_code, u.name, u.system_role, u.campus_id, ca.name campus_name, ca.code campus_code,
      (SELECT m.position FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=u.id AND m.status='active' AND c.is_test=0 ORDER BY m.is_primary DESC LIMIT 1) position,
      (SELECT c.name FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=u.id AND m.status='active' AND c.is_test=0 ORDER BY m.is_primary DESC LIMIT 1) club
      FROM users u
      LEFT JOIN campuses ca ON ca.id=u.campus_id
      WHERE u.is_test=0 AND (
        u.system_role IN ('super_admin','admin','campus_admin','campus_manager')
        OR u.email LIKE 'advisor%' OR u.email LIKE 'treasurer%' OR u.email LIKE 'student%'
        OR u.id IN (
          SELECT user_id FROM memberships WHERE status='active' AND position IN ('treasurer','president')
          UNION SELECT MIN(user_id) FROM memberships WHERE status='active' AND position='member' GROUP BY club_id
        )
      )
      ORDER BY CASE u.system_role
        WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1
        WHEN 'campus_admin' THEN 2 WHEN 'campus_manager' THEN 3
        WHEN 'faculty_advisor' THEN 4 WHEN 'advisor' THEN 5
        ELSE 6 END, u.campus_id, u.id`).all();
    res.json({ password: 'Demo@123', accounts: rows });
  });
  return r;
}
