// public/sw.js — service worker do PWA (viabilização zero-infra) · offline confiável após o 1º load
//
// Estratégia:
//   • NAVEGAÇÕES (HTML de rota) → network-first, cai p/ cache (updates aparecem online; offline abre).
//   • DEMAIS same-origin GET (JS/wasm/sqlite/css/ícones, content-hashed/imutáveis) → cache-first
//     (baixa UMA vez; o reading-lite ~64 MB e o léxico ~28 MB ficam no Cache Storage → reload offline OK).
//
// PRIVACIDADE (inegociável): o SW SÓ toca same-origin. As chamadas BYOK aos provedores de IA
// (api.anthropic.com, api.openai.com, …) e ao Google Drive são CROSS-ORIGIN — passam DIRETO, sem
// interceptar, sem cachear (nunca guardamos requisição/resposta com chave ou dado do usuário).
const CACHE = 'thelight-v1';

self.addEventListener('install', () => {
  // Ativa imediatamente (não espera abas antigas fecharem) — 1ª instalação já vale.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches de versões anteriores do SW.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST a provedores etc. — nunca intercepta
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CROSS-ORIGIN (BYOK/Drive) → passa direto, sem cache

  // ROBUSTEZ (revisão adversarial): TODA chamada ao CacheStorage é best-effort e ISOLADA. Se
  // `caches.open`/`match`/`put` falharem (modo privado, storage bloqueado, cota/evicção — plausível
  // pois cacheamos ~90 MB), a request NUNCA vira erro duro: cai p/ um `fetch` de rede puro. Um SW
  // jamais pode deixar o app PIOR do que sem SW. (`respondWith` com promessa REJEITADA = erro de
  // rede, sem fallback do browser — por isso nada de cache fica fora de try/catch.)

  // Navegações → network-first (pega updates online), cache/app-shell no offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          try {
            const c = await caches.open(CACHE);
            if (res && res.ok) await c.put(req, res.clone());
          } catch {
            /* cache indisponível — segue com a resposta de rede */
          }
          return res;
        } catch {
          // offline → tenta cache (best-effort); se o cache também falhar, erro honesto (offline real).
          try {
            const c = await caches.open(CACHE);
            return (await c.match(req)) || (await c.match('/')) || Response.error();
          } catch {
            return Response.error();
          }
        }
      })(),
    );
    return;
  }

  // Assets same-origin → cache-first (imutáveis por content-hash; DBs baixam uma vez).
  event.respondWith(
    (async () => {
      let cache = null;
      try {
        cache = await caches.open(CACHE);
      } catch {
        /* CacheStorage indisponível → cache=null; serve tudo direto da rede */
      }
      if (cache) {
        try {
          const hit = await cache.match(req);
          if (hit) return hit;
        } catch {
          /* match falhou — trata como miss, vai à rede */
        }
      }
      // Sem hit (ou sem cache): rede. Se a rede falhar aqui (offline + não-cacheado), o erro é
      // inevitável — idêntico ao comportamento SEM service worker.
      const res = await fetch(req);
      if (cache && res && res.ok && (res.type === 'basic' || res.type === 'default')) {
        try {
          await cache.put(req, res.clone());
        } catch {
          /* put best-effort */
        }
      }
      return res;
    })(),
  );
});
