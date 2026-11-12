import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');

function runStep(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: desktopRoot, stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

function waitForServer(url, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${url}`));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

await runStep('node', ['scripts/build-electron.mjs']);

const vite = spawn('npx', ['vite', '--port', '5174'], {
  cwd: desktopRoot,
  stdio: 'inherit'
});

await waitForServer('http://localhost:5174');

const electronBin = path.join(
  desktopRoot,
  '../../node_modules/.bin/electron'
);

const electronProc = spawn(electronBin, ['.'], {
  cwd: desktopRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://localhost:5174'
  }
});

const cleanup = () => {
  vite.kill();
  electronProc.kill();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

electronProc.on('exit', () => {
  vite.kill();
  process.exit(0);
});
