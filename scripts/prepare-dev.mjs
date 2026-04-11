/**
 * One-time / incremental setup so `npm run dev` works from a clean clone.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backend = path.join(root, 'backend');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const lockPath = path.join(root, 'package-lock.json');
const npmStamp = path.join(root, 'node_modules', '.dev-npm-stamp');
const pipStamp = path.join(backend, '.dev-pip-stamp');
const reqPath = path.join(backend, 'requirements.txt');

function hashFile(p) {
  if (!fs.existsSync(p)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function copyEnvIfMissing(dest, example) {
  if (fs.existsSync(dest) || !fs.existsSync(example)) return;
  fs.copyFileSync(example, dest);
  console.log(`[dev] Created ${path.relative(root, dest)} from ${path.relative(root, example)}`);
}

function venvPython() {
  const win = process.platform === 'win32';
  return win
    ? path.join(backend, 'venv', 'Scripts', 'python.exe')
    : path.join(backend, 'venv', 'bin', 'python3');
}

function venvPip() {
  const win = process.platform === 'win32';
  return win ? path.join(backend, 'venv', 'Scripts', 'pip.exe') : path.join(backend, 'venv', 'bin', 'pip');
}

function createVenv() {
  const win = process.platform === 'win32';
  const attempts = win
    ? [
        ['py', ['-3', '-m', 'venv', 'venv']],
        ['python', ['-m', 'venv', 'venv']],
        ['python3', ['-m', 'venv', 'venv']],
      ]
    : [
        ['python3', ['-m', 'venv', 'venv']],
        ['python', ['-m', 'venv', 'venv']],
      ];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { cwd: backend, stdio: 'inherit', shell: false });
    if (r.status === 0) return true;
  }
  return false;
}

function runNpmInstall(reason) {
  console.log(`[dev] ${reason}`);
  const r = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[dev] npm install failed.');
    process.exit(1);
  }
  try {
    fs.mkdirSync(path.dirname(npmStamp), { recursive: true });
    fs.writeFileSync(npmStamp, hashFile(lockPath), 'utf8');
  } catch {
    /* optional stamp */
  }
}

function runPipInstall(reason) {
  const pip = venvPip();
  if (!fs.existsSync(pip)) {
    console.error('[dev] pip not found in venv.');
    process.exit(1);
  }
  console.log(`[dev] ${reason}`);
  const r = spawnSync(pip, ['install', '-r', 'requirements.txt'], {
    cwd: backend,
    stdio: 'inherit',
    shell: false,
  });
  if (r.status !== 0) {
    console.error('[dev] pip install failed. Ensure Python 3 is installed and requirements.txt is valid.');
    process.exit(1);
  }
  fs.writeFileSync(pipStamp, hashFile(reqPath), 'utf8');
}

export function prepareDevEnvironment() {
  copyEnvIfMissing(path.join(root, '.env'), path.join(root, '.env.example'));
  copyEnvIfMissing(path.join(backend, '.env'), path.join(backend, '.env.example'));

  const lockHash = hashFile(lockPath);
  const needsNpm =
    !fs.existsSync(viteCli) ||
    !fs.existsSync(npmStamp) ||
    (lockHash && fs.readFileSync(npmStamp, 'utf8').trim() !== lockHash);

  if (needsNpm) {
    runNpmInstall(!fs.existsSync(viteCli) ? 'Installing frontend dependencies…' : 'Refreshing node_modules (lockfile changed)…');
  }

  if (!fs.existsSync(reqPath)) {
    console.error('[dev] Missing backend/requirements.txt');
    process.exit(1);
  }

  if (!fs.existsSync(venvPython())) {
    console.log('[dev] Creating Python virtualenv in backend/venv…');
    if (!createVenv()) {
      console.error(
        '[dev] Could not create venv. Install Python 3 from https://www.python.org/downloads/ and ensure `py -3` or `python` is on your PATH.'
      );
      process.exit(1);
    }
  }

  const reqHash = hashFile(reqPath);
  const needsPip =
    !fs.existsSync(pipStamp) ||
    (reqHash && fs.readFileSync(pipStamp, 'utf8').trim() !== reqHash);

  if (needsPip) {
    runPipInstall('Installing backend Python dependencies…');
  }

  if (!fs.existsSync(venvPython())) {
    console.error('[dev] backend/venv is incomplete.');
    process.exit(1);
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.normalize(path.resolve(entry)) === path.normalize(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  prepareDevEnvironment();
}
