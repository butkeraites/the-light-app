# Estratégia de cache/serving do bundle web (F5.17 · ADR-0045)

> Operacional. A decisão canônica está em `DECISIONS.md` → **ADR-0045**. Este arquivo é
> o cheat-sheet: o que é emitido, os números de TRANSFER medidos, e a config de host
> necessária para transformar o bundle em bytes-over-the-wire.

## O que o build emite

`scripts/compress-web-assets.sh <dist>` (chamado por `scripts/measure-web-bundle.sh`
após o `expo export --platform web`) emite, **ao lado** de cada asset grande/compressível
em `app/dist`:

- `<asset>.gz` — gzip nível 9 (piso universal: todo host/browser suporta).
- `<asset>.br` — brotli qualidade 11 (default moderno; menor).

Cobertura: `.wasm`, `.sqlite` (sempre) + `.js`/`.css`/`.html`/`.json`/`.svg`/`.map`/`.txt`
a partir de 1 KB. brotli vem do **`zlib` built-in do Node** — sem dependência do CLI
externo `brotli`; determinístico e offline.

**Zero-drift (lossless):** cada variante é DESCOMPRIMIDA e comparada byte-a-byte com a
origem antes de ser aceita (`emitVariantsVerified` em `scripts/lib/web-compress.cjs`); o
script joga se divergir. Verificação independente (CLIs do sistema):

```sh
W=app/dist/assets/web/generated/wasm-bindgen/index_bg.*.wasm
gunzip  -c "$W.gz" | cmp - $W   # → sem diferença
brotli  -dc "$W.br" | cmp - $W   # → sem diferença
```

## Transfer size medido (over-the-wire) — F5.17

Assets byte-estáveis (content-addressed → gzip/br determinísticos, gravados EXATOS na
baseline). Percentuais vs. bytes crus (em disco):

| asset (1º download)        |     raw |    gzip |  brotli | brotli vs raw |
| -------------------------- | ------: | ------: | ------: | ------------: |
| frontier `.wasm`           | 1198888 |  430849 |  311729 |       −74,0 % |
| wa-sqlite (FTS5) `.wasm`   |  666267 |  327579 |  282578 |       −57,6 % |
| `reading-lite.sqlite`      | 4530176 | 1728435 | 1089464 |       −76,0 % |
| `lexicon-sample.sqlite`\*  | 9502720 | 2957473 | 1841054 |       −80,6 % |
| **entry-JS (1º paint)**    | ~1314270 | ~332884 | ~262639 |       −80,0 % |

\* `lexicon-sample.sqlite` é ON-DEMAND (chunk async — só ao abrir estudo/léxico; F5.15),
não entra no caminho de leitura/1º paint.

**Headline de 1º paint over-the-wire** (`firstPaintTransferBytes` na baseline): o entry-JS
eager comprimido — **~332 KB gzip / ~262 KB brotli** (de ~1,28 MB crus). Um leitor puro
que abre um capítulo baixa, além disso, a wasm da fronteira (~312 KB br) + wa-sqlite
(~283 KB br) + `reading-lite.sqlite` (~1,04 MB br) — tudo LOCAL, cacheável imutável.

## Config de host necessária (o `expo export` estático NÃO seta headers sozinho)

O app busca os assets via `fetch(uri)` same-origin. O browser envia
`Accept-Encoding: gzip, br`; se o host servir a variante pré-comprimida com
`Content-Encoding`, o browser descomprime TRANSPARENTE e o `fetch()` devolve os bytes
ORIGINAIS (byte-idênticos → zero-drift, offline-first intacto). **A redução real
over-the-wire depende disto** — um `python -m http.server` sobre o `dist` cru serve os
bytes crus.

Assets content-hashed (`name.<hash>.ext`) ⇒ imutáveis ⇒ cache far-future seguro.

### nginx

```nginx
# emite as variantes .gz/.br pré-comprimidas quando presentes
gzip_static on;
brotli_static on;                       # requer ngx_brotli
location ~* \.(wasm|sqlite|js|css)$ {
  add_header Cache-Control "public, max-age=31536000, immutable";
  types { application/wasm wasm; }       # MIME correto do wasm
}
location = /index.html { add_header Cache-Control "no-cache"; }
```

### Netlify / Cloudflare Pages / Vercel

Comprimem na edge automaticamente (podem ignorar os `.gz`/`.br` e recomprimir) — as
variantes emitidas funcionam como hint/fallback. Fixe o cache dos assets hasheados:

```
# Netlify _headers
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable
```

## O que é aplicável AGORA vs. adiado

- **Emitido + medido (esta tarefa):** as variantes `.gz`/`.br` existem no `dist`, o
  transfer size (gzip/br) está gravado e rastreado na baseline, a losslessness é provada.
- **Requer camada de serving (deploy):** o ganho over-the-wire só se REALIZA atrás de um
  host que sirva as variantes com `Content-Encoding` (config acima). O loop não dita o
  servidor de produção; por isso documentamos a suposição em vez de afirmar headers vivos.
- **Fora de escopo:** travar o orçamento de performance (F5.19); adotar o split no nativo.
