// Runs the API (port 4000) and the Vite dev server (port 5173) together.
import { spawn } from 'node:child_process';
const env = { ...process.env, PUBLIC_URL: process.env.PUBLIC_URL || 'http://localhost:5173' };
const run = (name, args) => {
  const p = spawn('npm', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  p.on('exit', (code) => { console.log(`[${name}] exited with ${code}`); process.exit(code ?? 0); });
  return p;
};
const procs = [run('api', ['--workspace', 'apps/api', 'run', 'dev']), run('web', ['--workspace', 'apps/web', 'run', 'dev'])];
process.on('SIGINT', () => { procs.forEach((p) => p.kill()); process.exit(0); });
