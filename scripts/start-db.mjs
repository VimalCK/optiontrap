// Best-effort dev bootstrap: make sure Docker is running, then start the local
// Postgres container. The app itself creates/updates the schema via migrations
// on startup, so no extra DB setup is needed once the container is reachable.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = path.join(__dirname, '..', 'db', 'docker-compose.yml');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr || stdout}`.trim()));
      }
    });
  });
}

async function dockerReady() {
  try {
    await run('docker', ['info']);
    return true;
  } catch {
    return false;
  }
}

function launch(exe) {
  console.log(`[start-db] Launching ${exe} ...`);
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (err) => console.error(`[start-db] Failed to launch ${exe}: ${err.message}`));
  child.unref();
}

async function startDockerDesktop() {
  const platform = os.platform();

  if (platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'),
      path.join(process.env.LocalAppData || '', 'Programs', 'Docker', 'Docker Desktop', 'Docker Desktop.exe'),
    ];
    for (const exe of candidates) {
      if (existsSync(exe)) {
        launch(exe);
        return;
      }
    }
    try {
      const found = await run('cmd', ['/c', 'where', 'Docker Desktop.exe']);
      if (found) {
        launch(found.split('\n')[0].trim());
        return;
      }
    } catch {
      // fall through
    }
    throw new Error('Docker Desktop not found. Please start it manually.');
  }

  if (platform === 'darwin') {
    const exe = '/Applications/Docker.app/Contents/MacOS/Docker';
    if (existsSync(exe)) {
      launch(exe);
      return;
    }
    throw new Error('Docker Desktop not found in /Applications. Please start it manually.');
  }

  throw new Error(`Please start the Docker daemon for ${platform} manually.`);
}

async function waitForDocker(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await dockerReady()) return;
    process.stdout.write('.');
    await sleep(2000);
  }
  throw new Error('Timed out waiting for Docker to become ready.');
}

async function composeUp() {
  console.log('[start-db] Starting Postgres container...');
  await run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d']);
}

async function waitForPostgres(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(5433, 'localhost');
        socket.on('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', reject);
      });
      console.log('\n[start-db] Postgres is accepting connections on localhost:5433');
      return;
    } catch {
      // not ready yet
    }
    process.stdout.write('.');
    await sleep(1000);
  }
  throw new Error('Timed out waiting for Postgres on localhost:5433.');
}

async function main() {
  if (await dockerReady()) {
    console.log('[start-db] Docker is already running.');
  } else {
    console.log('[start-db] Docker not running; attempting to start Docker Desktop...');
    await startDockerDesktop();
    await waitForDocker();
    console.log('\n[start-db] Docker is ready.');
  }

  await composeUp();
  await waitForPostgres();
  console.log('[start-db] Database container ready. The server will run migrations on startup.');
}

main().catch((err) => {
  console.error(`[start-db] ${err.message}`);
  process.exit(1);
});
