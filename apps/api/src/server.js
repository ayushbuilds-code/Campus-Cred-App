import { defaultConfig } from './config.js';
import { createApp } from './app.js';
import { runScheduler } from './lib/jobs.js';

const cfg = defaultConfig();
if (process.env.NODE_ENV === 'production' && cfg.jwtSecret.startsWith('dev-only')) {
  console.error('Refusing to start: set a strong JWT_SECRET in production.');
  process.exit(1);
}
const { app, ctx, db } = createApp({ cfg });
const server = app.listen(cfg.port, () => {
  console.log(`CampusCred running on http://localhost:${cfg.port}  (QR links use ${cfg.publicUrl})`);
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
