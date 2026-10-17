import fs from 'node:fs';
import { defaultConfig } from './config.js';
import { openDb } from './schema.js';
import { makeCtx } from './ctx.js';
import { seedDemo } from './seed-data.js';

const cfg = defaultConfig();
const reset = process.argv.includes('--reset');
if (reset) for (const p of [cfg.dbPath, `${cfg.dbPath}-wal`, `${cfg.dbPath}-shm`]) fs.rmSync(p, { force: true });
if (reset) { fs.rmSync(cfg.certDir, { recursive: true, force: true }); fs.rmSync(cfg.uploadDir, { recursive: true, force: true }); }
fs.mkdirSync(cfg.certDir, { recursive: true });
fs.mkdirSync(cfg.uploadDir, { recursive: true });
const db = openDb(cfg.dbPath);
if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.log('Database already has data. Run `npm run seed -- --reset` to wipe it and reload the demo data.');
  process.exit(0);
}
const t = Date.now();
const out = await seedDemo(makeCtx({ db, cfg }));
const studentCount = db.prepare("SELECT COUNT(*) n FROM users WHERE system_role='student'").get().n;
console.log(`Seeded ${out.campuses.length} campuses, ${out.clubs.length} clubs, ${studentCount} students in ${Date.now() - t} ms.`);
console.log('Demo accounts ready (password: Demo@123): superadmin@campus.edu, admin.bengaluru@msot.example, admin.mumbai@apex.example, advisor.coding@msot.example, treasurer.coding@msot.example');
