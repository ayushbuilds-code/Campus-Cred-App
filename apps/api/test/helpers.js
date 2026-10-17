import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { defaultConfig } from '../src/config.js';
import { openDb } from '../src/schema.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed-data.js';

export const T0 = Date.parse('2026-10-10T05:00:00Z'); // a Saturday, 10:30 IST

export async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campuscred-test-'));
  const cfg = defaultConfig({ dbPath: ':memory:', uploadDir: path.join(dir, 'uploads'), certDir: path.join(dir, 'certs'), rateLimit: false,
    jwtSecret: 'test-secret-with-enough-length-123456', publicUrl: 'http://localhost:4000', rotateSeconds: 20 });
  const clock = { now: T0 };
  const db = openDb(':memory:');
  const { app, ctx } = createApp({ cfg, db, now: () => clock.now });
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const seed = await seedDemo(ctx, { rounds: 4 });
  const tok = (id) => jwt.sign({ id }, cfg.jwtSecret);
  async function call(method, url, { as, body, form, raw } = {}) {
    const headers = {};
    if (as != null) headers.authorization = `Bearer ${typeof as === 'number' ? tok(as) : as}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  const close = () => new Promise((r) => server.close(r));
  return { cfg, ctx, db, seed, clock, call, tok, base, close, dir };
}
export const dayStr = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
