/**
 * Ensures deps / venv / env files, then starts FastAPI and Vite together.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDevEnvironment } from './prepare-dev.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const startBackend = path.join(__dirname, 'start-backend.mjs');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

prepareDevEnvironment();

if (!fs.existsSync(viteCli)) {
  console.error('[dev] Vite still missing after setup. Try npm install manually.');
  process.exit(1);
}

const api = spawn(process.execPath, [startBackend], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});

const web = spawn(process.execPath, [viteCli], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    api.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  try {
    web.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

api.on('exit', (code) => {
  if (!shuttingDown) shutdown(code === 0 ? 0 : code ?? 1);
});

web.on('exit', (code) => {
  if (!shuttingDown) shutdown(code === 0 ? 0 : code ?? 1);
});

api.on('error', (err) => {
  console.error('[dev] Backend:', err.message);
  shutdown(1);
});

web.on('error', (err) => {
  console.error('[dev] Frontend:', err.message);
  shutdown(1);
});
