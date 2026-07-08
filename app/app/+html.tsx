// app/+html.tsx — shell HTML do export estático web (Expo Router) · Viabilização zero-infra (PWA)
//
// Envolve TODA página do export estático. Aqui vivem as tags que faltavam para o app ser um PWA
// INSTALÁVEL: <title> (antes VAZIO), manifest, theme-color, ícones (favicon + apple-touch), e as
// metas apple-mobile-web-app (iOS instala pelo Safari, SEM conta Apple). O registro do service
// worker (offline confiável) é um passo SEPARADO. Nada aqui acessa rede: é só cromo do documento.
//
// Caminhos ABSOLUTOS (/...): assumem hospedagem na RAIZ do domínio (Cloudflare Pages, domínio
// próprio, ou GitHub user-site `*.github.io`). Para um GitHub *project-site* em subpasta, definir
// `experiments.baseUrl` no app.json — seguimento futuro do deploy.
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const DESCRIPTION =
  'Leitura bíblica offline-first, com estudo por IA (traga sua chave), interlinear e privacidade. Sem conta, sem servidor.';

// Prefixo de hospedagem em SUBPASTA (GitHub Pages project-site: /the-light-app/). Vem do
// `experiments.baseUrl` do app.json, exposto pelo Expo em `EXPO_BASE_URL` no build. Sem baseUrl
// (dev / hospedagem na raiz) → string vazia → caminhos absolutos `/...` normais. Os assets do
// `public/` (manifest, ícones, sw.js) vão para a raiz do dist = a raiz da subpasta no deploy.
const BASE = process.env.EXPO_BASE_URL ?? '';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover: usa a tela toda no iOS instalado (notch). */}
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        <title>The Light — Bíblia offline</title>
        <meta name="description" content={DESCRIPTION} />

        {/* PWA: manifest + cor do tema (barra do navegador / splash no dark-first "Vigil"). */}
        <link rel="manifest" href={`${BASE}/manifest.webmanifest`} />
        <meta name="theme-color" content="#0b0b0f" />

        {/* Ícones: favicon (aba) + SVG escalável + apple-touch (tela de início do iOS). */}
        <link rel="icon" href={`${BASE}/favicon.png`} type="image/png" sizes="32x32" />
        <link rel="icon" href={`${BASE}/icon.svg`} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={`${BASE}/apple-touch-icon.png`} />

        {/* iOS: instala em tela cheia pelo Safari ("Adicionar à Tela de Início") — sem App Store. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="The Light" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* Reset do scroll do react-native-web no body (recomendado pelo Expo Router). */}
        <ScrollViewStyleReset />
      </head>
      <body>
        {children}
        {/* Registra o service worker (offline confiável após o 1º load). Best-effort: falha em
            silêncio onde SW não é suportado (ex.: http inseguro). Só same-origin é cacheado (ver sw.js).
            O SW é servido em `${BASE}/sw.js` com escopo `${BASE}/` — casa a subpasta do deploy. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${BASE}/sw.js',{scope:'${BASE}/'}).catch(function(){});});}`,
          }}
        />
      </body>
    </html>
  );
}
