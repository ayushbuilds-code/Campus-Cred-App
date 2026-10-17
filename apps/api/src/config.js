import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function defaultConfig(overrides = {}) {
  const isVercel = !!process.env.VERCEL;
  let dbPath = process.env.DB_PATH || path.join(apiRoot, 'data', 'campuscred.db');
  let uploadDir = process.env.UPLOAD_DIR || path.join(apiRoot, 'data', 'uploads');
  let certDir = process.env.CERT_DIR || path.join(apiRoot, 'data', 'certs');

  if (isVercel) {
    const tmpDbPath = '/tmp/campuscred.db';
    if (!fs.existsSync(tmpDbPath)) {
      const candidates = [
        dbPath,
        path.join(apiRoot, 'data', 'campuscred.db'),
        path.join(process.cwd(), 'apps', 'api', 'data', 'campuscred.db'),
        path.join(process.cwd(), 'data', 'campuscred.db'),
      ];
      for (const src of candidates) {
        if (fs.existsSync(src)) {
          try {
            fs.copyFileSync(src, tmpDbPath);
            break;
          } catch (e) {
            console.error('Failed copying database to /tmp:', e);
          }
        }
      }
    }
    dbPath = fs.existsSync(tmpDbPath) ? tmpDbPath : dbPath;
    uploadDir = '/tmp/uploads';
    certDir = '/tmp/certs';
  }

  return {
    port: Number(process.env.PORT || 4000),
    jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-before-deploying',
    dbPath,
    uploadDir,
    certDir,
    // Base URL that certificate QR codes point to (the web app's public address).
    publicUrl: (process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, ''),
    // QR / one-time code rotation period in seconds.
    rotateSeconds: Number(process.env.ROTATE_SECONDS || 20),
    demoMode: process.env.DEMO_MODE !== '0',
    rateLimit: process.env.RATE_LIMIT !== 'off',
    webDist: path.resolve(apiRoot, '..', 'web', 'dist'),
    ...overrides,
  };
}
