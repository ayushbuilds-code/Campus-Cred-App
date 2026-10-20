import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { parse, z, iso, bad, conflict, forbidden, notFound } from '../lib/util.js';
import { issueCertificate, sha256 } from '../lib/certs.js';
import { buildTranscript } from '../lib/stats.js';

export default function certRoutes(ctx) {
  const r = Router();
  const { db, access: acc } = ctx;
  const A = ctx.auth;
  const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  const canSeeStudent = (u, studentId) => {
    if (u.id === studentId) return true;
    if (u.system_role === 'super_admin' || u.system_role === 'admin') return true;
    const s = db.prepare('SELECT campus_id FROM users WHERE id=?').get(studentId);
    if (!s) throw notFound('Student not found');
    if (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') return s.campus_id === u.campus_id;
    if (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') return !!db.prepare(`SELECT 1 FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=? AND (c.advisor_id=? OR EXISTS (SELECT 1 FROM faculty_advisor_assignments fa WHERE fa.club_id=c.id AND fa.user_id=?)) AND m.status='active'`).get(studentId, u.id, u.id);
    return false;
  };

  r.get('/certificates', A, (req, res) => {
    const u = req.user;
    const uid = req.query.user_id ? Number(req.query.user_id) : u.id;
    acc.require(canSeeStudent(u, uid));
    const rows = db.prepare(`SELECT c.id,c.kind,c.title,c.detail,c.issued_at,c.status,cl.name club_name,e.name event_name
      FROM certificates c LEFT JOIN clubs cl ON cl.id=c.club_id LEFT JOIN events e ON e.id=c.event_id WHERE c.user_id=? ORDER BY c.issued_at DESC, c.id`).all(uid);
    res.json({ items: rows });
  });

  r.get('/certificates/:id/file', A, (req, res) => {
    const c = db.prepare('SELECT * FROM certificates WHERE id=?').get(req.params.id);
    if (!c) throw notFound('Certificate not found');
    acc.require(canSeeStudent(req.user, c.user_id));
    if (!fs.existsSync(c.file_path)) throw notFound('The certificate file is missing on the server.');
    res.download(c.file_path, `${c.id}.pdf`);
  });

  // Achievement certificates are issued by the club's faculty advisor (or admin)
  r.post('/certificates', A, async (req, res) => {
    const b = parse(z.object({ user_id: z.number().int(), club_id: z.number().int(), title: z.string().min(3).max(120), detail: z.string().max(300).optional() }), req.body);
    const c = acc.club(b.club_id);
    acc.require(acc.isAdmin(req.user) || acc.isAdvisor(req.user, c), 'Only the club’s faculty advisor can issue achievement certificates.');
    if (!acc.membership(b.user_id, c.id)) throw bad('That student is not an active member of this club.');
    const { cert } = await issueCertificate(ctx, { userId: b.user_id, clubId: c.id, kind: 'achievement', title: b.title, detail: b.detail, issuedBy: req.user.id });
    ctx.audit(req.user.id, 'certificate.issue', 'certificate', cert.id, { neu: { user_id: b.user_id, title: b.title } });
    ctx.notify([b.user_id], 'New certificate issued', b.title, '/certificates', { email: false });
    res.status(201).json({ id: cert.id });
  });

  r.post('/certificates/:id/revoke', A, (req, res) => {
    const c = db.prepare('SELECT * FROM certificates WHERE id=?').get(req.params.id);
    if (!c) throw notFound();
    const club = c.club_id ? acc.club(c.club_id) : null;
    acc.require(acc.isAdmin(req.user) || (club && acc.isAdvisor(req.user, club)), 'Only the issuing advisor or the admin can revoke a certificate.');
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
    if (c.status === 'revoked') throw conflict('Already revoked.');
    db.prepare("UPDATE certificates SET status='revoked', revoked_reason=? WHERE id=?").run(reason, c.id);
    ctx.audit(req.user.id, 'certificate.revoke', 'certificate', c.id, { reason });
    res.json({ ok: true });
  });

  // ---------- public verification (no login) ----------
  const recompute = (c, u, club, ev) => sha256(JSON.stringify([c.id, u.name, u.student_code, c.kind, c.title, c.detail || '', club?.name || '', ev?.name || '', c.issued_at]));
  const describe = (c) => {
    const u = db.prepare('SELECT name, student_code FROM users WHERE id=?').get(c.user_id);
    const club = c.club_id ? db.prepare('SELECT name FROM clubs WHERE id=?').get(c.club_id) : null;
    const ev = c.event_id ? db.prepare('SELECT name FROM events WHERE id=?').get(c.event_id) : null;
    const issuer = c.issued_by ? db.prepare('SELECT name FROM users WHERE id=?').get(c.issued_by) : null;
    return { id: c.id, status: c.status, revoked_reason: c.status === 'revoked' ? c.revoked_reason : undefined, kind: c.kind, title: c.title, detail: c.detail,
      holder: u.name, club: club?.name ?? null, event: ev?.name ?? null, issued_at: c.issued_at, issued_by: issuer?.name ?? null,
      record_intact: recompute(c, u, club, ev) === c.content_hash, content_hash: c.content_hash };
  };

  r.get('/public/verify/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM certificates WHERE id=?').get(req.params.id.toUpperCase());
    if (!c) return res.status(404).json({ found: false, error: 'No certificate with that ID was issued by CampusCred.' });
    res.json({ found: true, ...describe(c) });
  });

  // Upload a PDF to check it is byte-for-byte the file CampusCred issued.
  r.post('/public/verify-file', mem.single('file'), (req, res) => {
    if (!req.file) throw bad('Choose a PDF file to check.');
    const hash = sha256(req.file.buffer);
    const id = (req.body.id || '').trim().toUpperCase();
    const target = id ? db.prepare('SELECT * FROM certificates WHERE id=?').get(id) : db.prepare('SELECT * FROM certificates WHERE file_hash=?').get(hash);
    if (!target) return res.json({ match: false, message: id ? 'No certificate with that ID exists.' : 'This file does not match any certificate issued by CampusCred.' });
    const match = target.file_hash === hash;
    res.json({ match, message: match ? 'This file is exactly the certificate CampusCred issued.' : 'This file has been altered or is not the original certificate. Do not trust it.',
      certificate: match ? describe(target) : { id: target.id } });
  });

  // ---------- transcript ----------
  const transcriptFor = (req) => {
    const sid = Number(req.params.id === 'me' ? req.user.id : req.params.id);
    acc.require(canSeeStudent(req.user, sid));
    const st = db.prepare('SELECT system_role FROM users WHERE id=?').get(sid);
    if (!st || st.system_role !== 'student') throw notFound('Transcripts exist for students only.');
    return { sid, data: buildTranscript(ctx, sid) };
  };
  r.get('/students/:id/transcript', A, (req, res) => res.json(transcriptFor(req).data));
  r.get('/students/:id/transcript.pdf', A, async (req, res) => {
    const { sid, data } = transcriptFor(req);
    const { cert } = await issueCertificate(ctx, { userId: sid, kind: 'transcript', refKey: `transcript:${data.dataHash}`, title: 'Co-curricular transcript',
      detail: `Verified record of clubs, attendance, scores, events and certificates. Data hash ${data.dataHash}.`, transcript: data });
    res.download(cert.file_path, `transcript-${data.student.student_code || sid}.pdf`);
  });
  void forbidden; void iso;
  return r;
}
