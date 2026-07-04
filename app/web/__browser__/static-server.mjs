// app/web/__browser__/static-server.mjs — F6.1 (harness de smoke em browser REAL)
//
// Servidor estático zero-dependência (só `node:http`) que serve o `app/dist` produzido
// por `expo export --platform web`, do jeito que um host de produção estático serviria.
// Duas responsabilidades além do "servir arquivo":
//   1) ROTAS DINÂMICAS do expo-router: o export estático emite templates com colchetes
//      LITERAIS no nome (`read/[book]/[chapter].html`). Um GET em `/read/40/1` não casa
//      arquivo exato; então caminhamos pelos segmentos casando literal OU `[param]`, e
//      caímos em `+not-found.html` se nada casar.
//   2) MIME do `.wasm` = `application/wasm` — sem isso o `WebAssembly.instantiateStreaming`
//      degrada em silêncio no browser. O switch `SMOKE_WASM_WRONG_MIME=1` serve o wasm com
//      MIME ERRADO de propósito (usado pela F6.3 p/ provar que a guarda pega esse defeito).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.sqlite': 'application/octet-stream',
  '.db': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Nome de subdiretório de rota dinâmica (`[book]`, `[...rest]`) dentro de `dir`. */
function dynamicDir(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names.filter((n) => n.startsWith('[') && isDir(path.join(dir, n))).sort();
  return hit.length ? path.join(dir, hit[0]) : null;
}

/** Arquivo `[param].html` de rota dinâmica dentro de `dir`. */
function dynamicHtml(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names.filter((n) => n.startsWith('[') && n.endsWith('.html') && isFile(path.join(dir, n))).sort();
  return hit.length ? path.join(dir, hit[0]) : null;
}

/**
 * Resolve o HTML de uma rota (segmentos do pathname) contra os templates do expo-router.
 * Ex.: ['read','40','1'] → `read/[book]/[chapter].html`. Retorna caminho absoluto ou null.
 */
function resolveRouteHtml(distDir, segments) {
  if (segments.length === 0) {
    const idx = path.join(distDir, 'index.html');
    return isFile(idx) ? idx : null;
  }
  let dir = distDir;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = i === segments.length - 1;
    if (last) {
      const candidates = [path.join(dir, seg + '.html'), path.join(dir, seg, 'index.html')];
      const dyn = dynamicHtml(dir);
      if (dyn) candidates.push(dyn);
      for (const c of candidates) if (isFile(c)) return c;
      return null;
    }
    const literal = path.join(dir, seg);
    if (isDir(literal)) {
      dir = literal;
      continue;
    }
    const dyn = dynamicDir(dir);
    if (dyn) {
      dir = dyn;
      continue;
    }
    return null;
  }
  return null;
}

/** Resolve um pathname de request p/ um arquivo do dist (asset exato ou template de rota). */
function resolvePath(distDir, pathname) {
  // Normaliza e impede path traversal.
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.join(distDir, clean);
  if (!abs.startsWith(distDir)) return null; // fora do dist → recusa

  // 1) Asset/arquivo exato (js/wasm/sqlite/css/…).
  if (isFile(abs)) return abs;
  // 2) Diretório com index.html.
  if (isDir(abs) && isFile(path.join(abs, 'index.html'))) return path.join(abs, 'index.html');

  // 3) Rota do expo-router (templates com [param]).
  const segments = clean.split('/').filter(Boolean);
  const route = resolveRouteHtml(distDir, segments);
  if (route) return route;

  // 4) Fallback SPA/404 do expo-router.
  const notFound = path.join(distDir, '+not-found.html');
  return isFile(notFound) ? notFound : null;
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wasm' && process.env.SMOKE_WASM_WRONG_MIME === '1') {
    // F6.3: MIME ERRADO de propósito — quebra o instantiateStreaming (degrada em silêncio).
    return 'application/octet-stream';
  }
  return MIME[ext] || 'application/octet-stream';
}

/** Cria (sem escutar) o servidor estático p/ `distDir`. */
export function createStaticServer(distDir) {
  const root = path.resolve(distDir);
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = resolvePath(root, url.pathname);
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': contentTypeFor(file),
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('500 ' + (err && err.message ? err.message : String(err)));
    }
  });
}

/** Sobe o servidor estático em `port`. Resolve com `{ server, port, close() }`. */
export function startStaticServer(distDir, port) {
  const server = createStaticServer(distDir);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Execução direta: `node static-server.mjs <distDir> <port>` (uso manual/depuração).
if (import.meta.url === `file://${process.argv[1]}`) {
  const distDir = process.argv[2] || path.resolve(process.cwd(), 'dist');
  const port = Number(process.argv[3] || 8100);
  startStaticServer(distDir, port).then(({ port: p }) => {
    process.stdout.write(`static-server: http://127.0.0.1:${p} (dist=${distDir})\n`);
  });
}
