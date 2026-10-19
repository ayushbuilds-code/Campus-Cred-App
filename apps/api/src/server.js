import { defaultConfig } from './config.js';
import { createApp } from './app.js';
import { runScheduler } from './lib/jobs.js';

import crypto from 'node:crypto';

const cfg = defaultConfig();
if (cfg.jwtSecret.startsWith('dev-only')) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️ WARNING: No JWT_SECRET set. Using an auto-generated random secret for this session. Set JWT_SECRET in environment variables to persist sessions across redeploys.');
    cfg.jwtSecret = crypto.randomBytes(32).toString('hex');
  }
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
