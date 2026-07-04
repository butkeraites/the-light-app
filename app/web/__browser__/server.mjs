// app/web/__browser__/server.mjs — F6.1 (harness de smoke em browser REAL)
//
// Ciclo de vida DETERMINÍSTICO do servidor web para os dois alvos do smoke:
//
//   dev  — sobe `npx expo start --web --port <p>` num GRUPO DE PROCESSO próprio
//          (detached), espera `http://localhost:<p>/status` devolver
//          `packager-status:running` (o MESMO readiness-check do
//          scripts/run-ios-selftest.sh), com timeout; teardown mata o grupo inteiro.
//
//   dist — `expo export --platform web` (do jeito do scripts/measure-web-bundle.sh:
//          `rm -rf dist` + `npx expo export --platform web`) e então sobe o
//          `static-server.mjs`; espera health; teardown fecha o servidor.
//
// Cada alvo usa PORTA PRÓPRIA (não depende de nenhum server externo já de pé, ex.: :8081
// desta sessão) e devolve `{ baseUrl, cleanup }`. O `cleanup` é idempotente e chamado
// tanto no fim normal quanto em trap de sinal/erro (sem processos órfãos).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStaticServer } from './static-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..', '..'); // .../app
const DIST_DIR = path.join(APP_DIR, 'dist');

const DEV_PORT = Number(process.env.SMOKE_DEV_PORT || 8099);
const DIST_PORT = Number(process.env.SMOKE_DIST_PORT || 8100);
const DEV_READY_TIMEOUT_MS = Number(process.env.SMOKE_DEV_TIMEOUT_MS || 180000);
const EXPORT_TIMEOUT_MS = Number(process.env.SMOKE_EXPORT_TIMEOUT_MS || 600000);

function log(msg) {
  process.stdout.write(`[smoke:server] ${msg}\n`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Polla uma URL até `predicate(text)` ou timeout. Devolve true/false. */
async function poll(url, predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (predicate(res, text)) return true;
    } catch {
      // servidor ainda subindo — tenta de novo
    }
    await sleep(intervalMs);
  }
  return false;
}

/** dev: `expo start --web` em grupo de processo próprio + readiness em /status. */
async function startDev() {
  const port = DEV_PORT;
  log(`dev: npx expo start --web --port ${port} (grupo de processo próprio)`);
  const child = spawn('npx', ['expo', 'start', '--web', '--port', String(port)], {
    cwd: APP_DIR,
    detached: true, // novo grupo de processo → teardown mata o grupo todo
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', BROWSER: 'none', EXPO_NO_TELEMETRY: '1' },
  });
  const tail = [];
  const capture = (buf) => {
    const s = buf.toString();
    tail.push(s);
    if (tail.length > 40) tail.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  let killed = false;
  const cleanup = async () => {
    if (killed) return;
    killed = true;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // grupo já morto
    }
    await sleep(500);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // já morto
    }
  };

  const ready = await poll(
    `http://localhost:${port}/status`,
    (_res, text) => text.includes('packager-status:running'),
    DEV_READY_TIMEOUT_MS,
  );
  if (!ready) {
    await cleanup();
    throw new Error(
      `dev: Metro não ficou pronto em :${port} em ${DEV_READY_TIMEOUT_MS}ms.\n--- tail ---\n${tail.join('')}`,
    );
  }
  log(`dev: pronto em http://localhost:${port}`);
  return { baseUrl: `http://localhost:${port}`, cleanup };
}

/** dist: `expo export` (rm -rf dist + export) + static-server + health. */
async function startDist() {
  const port = DIST_PORT;
  if (process.env.SMOKE_DIST_REUSE === '1' && fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    log('dist: SMOKE_DIST_REUSE=1 — reusando dist existente (NÃO usado pelo loop)');
  } else {
    log('dist: rm -rf dist && npx expo export --platform web (offline; só assets locais)');
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    const res = spawnSync('npx', ['expo', 'export', '--platform', 'web'], {
      cwd: APP_DIR,
      stdio: 'inherit',
      timeout: EXPORT_TIMEOUT_MS,
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    });
    if (res.status !== 0) {
      throw new Error(`dist: 'expo export' falhou (status=${res.status}, signal=${res.signal})`);
    }
  }
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(`dist: export não gerou ${DIST_DIR}/index.html`);
  }

  const handle = await startStaticServer(DIST_DIR, port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const cleanup = async () => {
    await handle.close();
  };

  const ok = await poll(`${baseUrl}/index.html`, (res) => res.ok, 15000);
  if (!ok) {
    await cleanup();
    throw new Error(`dist: static-server não respondeu em ${baseUrl}`);
  }
  log(`dist: pronto em ${baseUrl} (static-server sobre ${DIST_DIR})`);
  return { baseUrl, cleanup };
}

/** Sobe o alvo pedido (`dev`|`dist`) e devolve `{ baseUrl, cleanup }`. */
export async function startTarget(target) {
  if (target === 'dev') return startDev();
  if (target === 'dist') return startDist();
  throw new Error(`alvo desconhecido: ${target} (use dev|dist)`);
}
