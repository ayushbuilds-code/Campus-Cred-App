import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse, z, iso, bad, conflict, forbidden, notFound, HttpError } from '../lib/util.js';
import { issueCertificate } from '../lib/certs.js';

const ALLOWED = new Set(['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.zip']);

export default function workRoutes(ctx) {
  const r = Router();
  const { db, access: acc, cfg } = ctx;
  const A = ctx.auth;

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, cfg.uploadDir),
      filename: (req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => (ALLOWED.has(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new HttpError(400, 'Upload a PDF, PPT/PPTX, DOC/DOCX, PNG, JPG or ZIP file.'))),
  });

  const loadActivity = (id) => {
    const a = db.prepare('SELECT a.*, cd.date FROM activities a JOIN club_days cd ON cd.id=a.club_day_id WHERE a.id=?').get(id);
    if (!a) throw notFound('Activity not found');
    return a;
  };

  // ---------- Submissions ----------
  r.post('/activities/:id/submissions', A, ctx.roles('student'), upload.single('file'), (req, res) => {
    const cleanup = () => req.file && fs.rmSync(req.file.path, { force: true });
    try {
      const a = loadActivity(req.params.id), c = acc.club(a.club_id), u = req.user;
      if (!acc.isMember(u, c)) throw forbidden('Only members of this club can submit work.');
      if (a.status !== 'approved') throw conflict('This activity is not open for submissions.');
      if (a.format === 'on_the_spot') throw conflict('This activity has nothing to submit.');
      if (a.submission_deadline && a.submission_deadline < iso(ctx.now())) throw new HttpError(403, 'The deadline has passed. Ask a coordinator if you need an exception.');
      const link = req.body.link_url?.trim();
      if (!req.file && !link) throw bad('Upload a file or paste a link.');
      if (link && !/^https?:\/\/\S+$/i.test(link)) throw bad('The link must start with http:// or https://');
      const note = (req.body.note || '').slice(0, 500) || null;
      const ex = db.prepare('SELECT * FROM submissions WHERE activity_id=? AND user_id=?').get(a.id, u.id);
      const t = iso(ctx.now());
      if (ex) {
        db.prepare('UPDATE submissions SET type=?,file_path=?,original_name=?,link_url=?,note=?,updated_at=? WHERE id=?')
          .run(req.file ? 'file' : 'link', req.file?.path ?? null, req.file?.originalname ?? null, req.file ? null : link, note, t, ex.id);
        if (ex.file_path) fs.rmSync(ex.file_path, { force: true });
        db.prepare('DELETE FROM evaluations WHERE submission_id=? AND published=0').run(ex.id); // a new version needs a fresh score
        return res.json({ id: ex.id, resubmitted: true });
      }
      const info = db.prepare('INSERT INTO submissions(activity_id,user_id,type,file_path,original_name,link_url,note,submitted_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(a.id, u.id, req.file ? 'file' : 'link', req.file?.path ?? null, req.file?.originalname ?? null, req.file ? null : link, note, t);
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) { cleanup(); throw e; }
  });

  r.get('/activities/:id/submissions', A, (req, res) => {
    const a = loadActivity(req.params.id), c = acc.club(a.club_id), u = req.user;
    const all = acc.canViewClubData(u, c);
    if (!all && !acc.isMember(u, c)) throw forbidden();
    const rows = db.prepare(`SELECT s.id, s.user_id, u.name, u.student_code, s.type, s.original_name, s.link_url, s.note, s.submitted_at,
      e.content, e.presentation, e.participation, e.total, e.comment, e.published, e.updated_at scored_at, ev.name evaluator
      FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN evaluations e ON e.submission_id=s.id LEFT JOIN users ev ON ev.id=e.evaluator_id
      WHERE s.activity_id=? ${all ? '' : 'AND s.user_id=?'} ORDER BY u.name`).all(...(all ? [a.id] : [a.id, u.id]));
    // students only ever see their own score, and only once it is published
    const items = rows.map((x) => (all || x.published ? x : { ...x, content: null, presentation: null, participation: null, total: null, comment: null }));
    const missing = all ? db.prepare(`SELECT u.id user_id, u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=? AND m.status='active'
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.activity_id=? AND s.user_id=u.id) ORDER BY u.name`).all(c.id, a.id) : [];
    res.json({ items, missing, weights: ctx.setting('rubric_weights') });
  });

  r.get('/submissions/:id/file', A, (req, res) => {
    const s = db.prepare('SELECT s.*, a.club_id FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE s.id=?').get(req.params.id);
    if (!s) throw notFound();
    const c = acc.club(s.club_id);
    acc.require(s.user_id === req.user.id || acc.canViewClubData(req.user, c));
    if (s.type !== 'file' || !s.file_path || !fs.existsSync(s.file_path)) throw notFound('No file for this submission.');
    res.download(s.file_path, s.original_name);
  });

  // ---------- Evaluation ----------
  const score = z.number().int().min(0).max(10);
  r.put('/submissions/:id/evaluation', A, (req, res) => {
    const s = db.prepare('SELECT s.*, a.club_id FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE s.id=?').get(req.params.id);
    if (!s) throw notFound();
    const c = acc.club(s.club_id), u = req.user;
    acc.require(acc.canEvaluate(u, c), 'Only coordinators or the advisor can score submissions.');
    if (s.user_id === u.id) throw forbidden('You cannot score your own work. Ask the advisor to score it.');
    const b = parse(z.object({ content: score, presentation: score, participation: score, comment: z.string().max(500).optional() }), req.body);
    const w = ctx.setting('rubric_weights');
    const total = Math.round(((b.content * w.content + b.presentation * w.presentation + b.participation * w.participation) / (w.content + w.presentation + w.participation)) * 100) / 100;
    const ex = db.prepare('SELECT * FROM evaluations WHERE submission_id=?').get(s.id);
    const t = iso(ctx.now());
    if (ex) {
      db.prepare('UPDATE evaluations SET evaluator_id=?,content=?,presentation=?,participation=?,total=?,comment=?,updated_at=? WHERE id=?').run(u.id, b.content, b.presentation, b.participation, total, b.comment ?? null, t, ex.id);
      ctx.audit(u.id, 'score.change', 'evaluation', ex.id, { old: { total: ex.total, published: ex.published }, neu: { total }, reason: b.comment });
    } else {
      const info = db.prepare('INSERT INTO evaluations(submission_id,evaluator_id,content,presentation,participation,total,comment,published,updated_at) VALUES (?,?,?,?,?,?,?,0,?)').run(s.id, u.id, b.content, b.presentation, b.participation, total, b.comment ?? null, t);
      ctx.audit(u.id, 'score.create', 'evaluation', info.lastInsertRowid, { neu: { total } });
    }
    res.json({ total });
  });

  // Publishing makes scores visible and auto-issues participation certificates.
  r.post('/activities/:id/publish-scores', A, async (req, res) => {
    const a = loadActivity(req.params.id), c = acc.club(a.club_id);
    acc.require(acc.canEvaluate(req.user, c), 'Only coordinators or the advisor can publish scores.');
    const rows = db.prepare(`SELECT e.id, s.user_id FROM evaluations e JOIN submissions s ON s.id=e.submission_id WHERE s.activity_id=? AND e.published=0`).all(a.id);
    db.transaction(() => { for (const x of rows) db.prepare('UPDATE evaluations SET published=1 WHERE id=?').run(x.id); })();
    ctx.audit(req.user.id, 'scores.publish', 'activity', a.id, { neu: { count: rows.length } });
    ctx.notify(rows.map((x) => x.user_id), `Scores published: ${a.topic}`, `${c.name}: open the activity to see your score and comments.`, `/activities/${a.id}`);
    // participation certificate: attended AND (submitted OR no deliverable expected)
    const eligible = db.prepare(`SELECT m.user_id FROM memberships m JOIN sessions se ON se.activity_id=? WHERE m.club_id=? AND m.status='active'
      AND EXISTS (SELECT 1 FROM attendance at WHERE at.session_id=se.id AND at.user_id=m.user_id AND at.status IN ('present','late'))
      AND (? = 'on_the_spot' OR EXISTS (SELECT 1 FROM submissions s WHERE s.activity_id=? AND s.user_id=m.user_id))`).all(a.id, c.id, a.format, a.id);
    let issued = 0;
    for (const e of eligible) {
      const { created } = await issueCertificate(ctx, { userId: e.user_id, clubId: c.id, kind: 'participation', refKey: `activity:${a.id}`,
        title: `Participation in ${c.name} Club Day`, detail: `For attending and contributing to "${a.topic}" on ${a.date}.`, issuedBy: c.advisor_id });
      if (created) { issued++; ctx.notify([e.user_id], 'New certificate issued', `Participation in ${c.name}: ${a.topic}`, '/certificates', { email: false }); }
    }
    res.json({ published: rows.length, certificates_issued: issued });
  });

  r.get('/me/scores', A, (req, res) => {
    res.json({ items: db.prepare(`SELECT e.content,e.presentation,e.participation,e.total,e.comment,a.id activity_id,a.topic,c.name club_name,cd.date
      FROM evaluations e JOIN submissions s ON s.id=e.submission_id JOIN activities a ON a.id=s.activity_id JOIN clubs c ON c.id=a.club_id JOIN club_days cd ON cd.id=a.club_day_id
      WHERE s.user_id=? AND e.published=1 ORDER BY cd.date DESC`).all(req.user.id) });
  });
  return r;
}
