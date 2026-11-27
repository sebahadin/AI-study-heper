#!/usr/bin/env node
// Start local services together; MongoDB remains managed separately.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import readline from 'node:readline';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const { parse } = requireBackend('dotenv');
const shared = existsSync(path.join(root, '.env')) ? parse(readFileSync(path.join(root, '.env'))) : {};
const ai = Object.fromEntries(Object.entries(shared).filter(([key]) => key.startsWith('AI_')));
const env = { ...ai, ...process.env, ANONYMIZED_TELEMETRY: 'False' };
const { settings } = await import('../backend/src/config.mjs');
// Use the same resolved credentials and endpoint in every service.
env.AI_SERVICE_TOKEN = settings.aiServiceToken;
env.AI_SERVICE_URL = settings.aiServiceUrl;
const python = path.join(root, 'ai-service/.venv/bin/python');
const chroma = path.join(root, 'ai-service/.venv/bin/chroma');
const apiUrl = new URL(settings.aiServiceUrl);
const ports = { express: settings.port, python: Number(apiUrl.port || 8001), chroma: Number(env.AI_CHROMA_PORT || 8002), react: 5173 };
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
  }
  setTimeout(() => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
    process.exit(code);
  }, 1000);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

async function open(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
function launch(name, command, args, cwd, extra = {}) {
  const child = spawn(command, args, { cwd, env: { ...env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on('line', line => console.log(`[${name}] ${line}`));
  }
  child.on('error', () => { console.error(`${name} could not start.`); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${name} stopped (${code ?? 'signal'}).`); stop(1); } });
}
async function ready(port) {
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    if (await open(port)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('A local service did not become available. Check its output above.');
}
try {
  if (!existsSync(python) || !existsSync(chroma)) throw new Error('Install Python dependencies first: uv sync --directory ai-service --locked');
  if (!settings.dsn) throw new Error('Set DSN in backend/.env and start MongoDB.');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(settings.aiServiceToken || '')) throw new Error('Set the shared AI_SERVICE_TOKEN in the repository-root .env.');
  if (!['localhost', '127.0.0.1'].includes(apiUrl.hostname) || !['localhost', '127.0.0.1'].includes(env.AI_CHROMA_HOST || '127.0.0.1')) throw new Error('This development launcher requires local Python and Chroma endpoints.');
  if (new Set(Object.values(ports)).size !== 4) throw new Error('Give each local service a separate port.');
  const occupied = (await Promise.all(Object.entries(ports).map(async ([name, port]) => await open(port) ? `${name} (${port})` : null))).filter(Boolean);
  if (occupied.length) throw new Error(`Stop the already running services before starting this stack: ${occupied.join(', ')}.`);
  const chromaPath = path.resolve(root, 'ai-service', env.AI_CHROMA_PATH || '.cache/chroma-server');
  mkdirSync(chromaPath, { recursive: true });
  launch('chroma', chroma, ['run', '--host', '127.0.0.1', '--port', String(ports.chroma), '--path', chromaPath], root);
  await ready(ports.chroma);
  launch('python', python, ['-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', String(ports.python), '--no-access-log'], path.join(root, 'ai-service'), { AI_SERVICE_TOKEN: settings.aiServiceToken });
  launch('express', process.execPath, ['node_modules/nodemon/bin/nodemon.js', 'src/app.mjs'], path.join(root, 'backend'));
  await Promise.all([ready(ports.python), ready(ports.express)]);
  launch('worker', python, ['-m', 'app.workers.documents'], path.join(root, 'ai-service'), {
    AI_SERVICE_TOKEN: settings.aiServiceToken, AI_CLASSMATE_URL: `http://127.0.0.1:${ports.express}`, AI_CHROMA_PORT: String(ports.chroma),
  });
  launch('react', process.execPath, ['node_modules/vite/bin/vite.js'], path.join(root, 'frontend'), { API_PROXY_TARGET: `http://127.0.0.1:${ports.express}` });
  await ready(ports.react);
  console.log('Classmate: http://127.0.0.1:5173 — Ctrl+C stops this stack. Indexing starts after local model warmup.');
} catch (error) {
  console.error(error.message);
  if (children.length) stop(1); else process.exitCode = 1;
}
