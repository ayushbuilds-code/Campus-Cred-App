import { defaultConfig } from './config.js';
import { createApp } from './app.js';
import { runScheduler } from './lib/jobs.js';

import crypto from 'node:crypto';

const cfg = defaultConfig();
// Ensure a consistent secret is used across all instances so tokens don't fail verification
if (!cfg.jwtSecret || cfg.jwtSecret.startsWith('dev-only')) {
  cfg.jwtSecret = process.env.JWT_SECRET || 'campuscred-auth-secret-key-production-fallback-2026-secure';
}
const { app, ctx, db } = createApp({ cfg });
const port = Number(process.env.PORT || cfg.port || 3000);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`CampusCred running on http://0.0.0.0:${port}  (QR links use ${cfg.publicUrl})`);
  if (cfg.demoMode) console.log('Demo mode is ON: demo accounts are listed on the login screen (password Demo@123).');
});
// "7 days before / 3 days before / 48 h / month-end" automation
const tick = () => { try { runScheduler(ctx); } catch (e) { console.error('scheduler error', e); } };
setTimeout(tick, 3000);
setInterval(tick, 60 * 1000).unref();

// graceful shutdown: stop accepting requests, flush the database, then exit
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { try { db.close(); } catch { /* already closed */ } process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
}
