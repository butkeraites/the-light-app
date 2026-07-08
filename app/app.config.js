// app.config.js — config DINÂMICA do Expo (estende o app.json estático).
//
// Único papel: ligar `experiments.baseUrl` SÓ quando exportando p/ hospedagem em SUBPASTA (deploy
// no GitHub Pages project-site: /the-light-app/). Assim, `expo start` (dev) e o smoke em browser
// seguem servindo na RAIZ (sem baseUrl) — nada quebra localmente — e apenas o job de deploy
// (`DEPLOY_BASE_URL=/the-light-app npx expo export`) recebe o prefixo de subpasta. O Expo então
// expõe esse valor como `process.env.EXPO_BASE_URL`, que o `app/+html.tsx` usa nos links do PWA.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...(config.experiments || {}),
    ...(process.env.DEPLOY_BASE_URL ? { baseUrl: process.env.DEPLOY_BASE_URL } : {}),
  },
});
