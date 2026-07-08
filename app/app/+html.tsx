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
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0b0b0f" />

        {/* Ícones: favicon (aba) + SVG escalável + apple-touch (tela de início do iOS). */}
        <link rel="icon" href="/favicon.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

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
            silêncio onde SW não é suportado (ex.: http inseguro). Só same-origin é cacheado (ver sw.js). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}",
          }}
        />
      </body>
    </html>
  );
}
