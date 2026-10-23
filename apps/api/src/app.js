import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from './schema.js';
import { makeCtx } from './ctx.js';
import { createAccess } from './lib/access.js';
import { HttpError, forbidden } from './lib/util.js';
import authRoutes from './routes/auth.js';
import miscRoutes from './routes/misc.js';
import clubRoutes from './routes/clubs.js';
import dayRoutes from './routes/days.js';
import workRoutes from './routes/work.js';
import eventRoutes from './routes/events.js';
import certRoutes from './routes/certs.js';
import insightRoutes from './routes/insights.js';

export function createApp({ cfg, db, now }) {
  db = db || openDb(cfg.dbPath);
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  fs.mkdirSync(cfg.certDir, { recursive: true });
  const ctx = makeCtx({ db, cfg, now });
  ctx.access = createAccess(db);

  const noop = (req, res, next) => next();
  const limited = (opts) => (cfg.rateLimit ? rateLimit({ standardHeaders: true, legacyHeaders: false, ...opts }) : noop);
  ctx.loginLimiter = limited({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: 'Too many attempts. Wait a few minutes and try again.' } });
  // check-in is limited per student, not per IP, because a whole campus can share one Wi-Fi address
  ctx.checkinLimiter = limited({ windowMs: 60 * 1000, limit: 30, keyGenerator: (req) => `user-${req.user?.id ?? 'anon'}`, validate: false, message: { error: 'Too many check-in attempts. Wait a minute.' } });

  const jwtKey = crypto.createSecretKey(Buffer.from(cfg.jwtSecret));
  const qUser = db.prepare('SELECT id,name,email,student_code,system_role,campus_id FROM users WHERE id=?');
  ctx.auth = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Please log in.');
    let p;
    try { p = jwt.verify(h.slice(7), jwtKey, { algorithms: ['HS256'] }); } catch { throw new HttpError(401, 'Your session has expired. Please log in again.'); }
    const u = qUser.get(p.id);
    if (!u) throw new HttpError(401, 'Account not found.');
    req.user = u;
    next();
  };
  const ROLE_ALIASES = {
    super_admin: ['super_admin', 'admin'],
    admin: ['super_admin', 'admin'],
    campus_admin: ['campus_admin', 'campus_manager'],
    campus_manager: ['campus_admin', 'campus_manager'],
    faculty_advisor: ['faculty_advisor', 'advisor'],
    advisor: ['faculty_advisor', 'advisor'],
    student: ['student'],
  };
  ctx.roles = (...roles) => (req, res, next) => {
    const allowed = new Set(roles.flatMap((r) => ROLE_ALIASES[r] || [r]));
    if (!allowed.has(req.user.system_role)) throw forbidden();
    next();
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // API responses are never cached; skip hashing every body (static files keep their own validators)
  app.set('trust proxy', 1);

  // Always allow Capacitor native-app origins so the Android/iOS APK can reach the API.
  // Additional origins can be added via CORS_ORIGIN (comma-separated) in the environment.
  // cors() must run BEFORE helmet() so its headers are not overridden.
  const NATIVE_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
  const extraOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : [];
  const allowedOrigins = new Set([...NATIVE_ORIGINS, ...extraOrigins]);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (curl, Postman, same-origin server-side)
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        callback(null, false);
      },
      credentials: true,
    }),
  );

  // crossOriginResourcePolicy must be 'cross-origin' so browsers can read API responses
  // from a different origin (capacitor://localhost → campuscred-gd43.onrender.com).
  app.use(helmet({ crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(express.json({ limit: '300kb' }));

  const api = express.Router();
  api.use(limited({ windowMs: 60 * 1000, limit: 900, skip: (req) => req.path.startsWith('/checkin') }));
  api.use((req, res, next) => {
    const campusHdr = req.headers['x-campus-id'];
    if (campusHdr && !req.query.campus_id) {
      const q = { ...req.query, campus_id: campusHdr };
      Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true });
    }
    next();
  });
  for (const mod of [dayRoutes, authRoutes, miscRoutes, clubRoutes, workRoutes, eventRoutes, certRoutes, insightRoutes]) api.use(mod(ctx));
  api.get('/health', (req, res) => res.json({ ok: true, time: new Date(ctx.now()).toISOString() }));
  app.use('/api/v1', api);
  app.use('/v1', api);
  app.use('/api', api);

  if (fs.existsSync(path.join(cfg.webDist, 'index.html'))) {
    app.use(express.static(cfg.webDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/v1')) return next();
      res.sendFile(path.join(cfg.webDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. The limit is 10 MB.' : err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
  });
  return { app, ctx, db };
}
