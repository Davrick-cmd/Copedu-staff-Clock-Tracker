/**
 * Runs FastAPI from backend/ using venv Python when present, else system python.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(__dirname, '..', 'backend');

function findPython() {
  const win = process.platform === 'win32';
  const candidates = win
    ? [
        path.join(backend, 'venv', 'Scripts', 'python.exe'),
        path.join(backend, 'venv', 'Scripts', 'python3.exe'),
      ]
    : [
        path.join(backend, 'venv', 'bin', 'python3'),
        path.join(backend, 'venv', 'bin', 'python'),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  console.error('[dev:api] No backend/venv Python found. Run npm run dev once to create the venv.');
  process.exit(1);
}

const py = findPython();
const child = spawn(
  py,
  ['-m', 'uvicorn', 'main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
  { cwd: backend, stdio: 'inherit', shell: false }
);

child.on('error', (err) => {
  console.error('[dev:api] Failed to start backend:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
