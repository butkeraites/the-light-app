// app/web/research.web.ts — F3.12b (ADR-0028/ADR-0032)
//
// PESQUISA WEB WIKIPEDIA (opt-in, KEYLESS) — infra TS de RECUPERAÇÃO (o par web do
// `ai::research::WikipediaProvider`, que é `embedded`-only/reqwest e NÃO existe no wasm).
// Faz um `fetch` à API pública da Wikipedia (SEM chave/segredo) e mapeia os resultados de
// busca em `StudyWebSourceInput[]` — que a fronteira `study_web_prepare`/`study_web_finalize`
// (F3.12a) já ACEITA. O prompt `[W:n]`, as citações `kind="Web"` (das URLs) e o `verify`
// vêm do MESMO Rust `ai-pure` (ZERO DRIFT) — aqui NADA de anti-alucinação é reimplementado:
// esta camada só RECUPERA fontes (título/URL/trecho), como o SELECT do léxico/xref
// (infra sancionada, ADR-0011).
//
// PRIVACIDADE / OPT-IN (ADR-0028): é a ÚNICA rede além do LLM, e só ocorre quando o usuário
// LIGA a pesquisa web (padrão DESLIGADO no `ReaderStudyPanel` + aviso de privacidade). A API
// da Wikipedia é KEYLESS — NENHUM segredo entra na URL/header/log. O `fetch` é INJETÁVEL (a
// prova headless passa um MOCK; produção usa `globalThis.fetch`).
import type { StudyWebSourceInput } from './generated/the_light_app_core';
import type { AiFetch } from './ai-anchored.web';

/** Limite default de fontes (espelha `DEFAULT_RESEARCH_LIMIT = 4` do core nativo). */
export const DEFAULT_WIKIPEDIA_LIMIT = 4;

/**
 * Subdomínio de idioma da Wikipedia (`pt`/`en`) a partir do `lang` do app ("pt"|"en" +
 * sinônimos). Default `en` (mesmo default sensato do core). NÃO é lógica de domínio, só a
 * escolha do host keyless da consulta.
 */
function wikipediaLang(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (l.startsWith('pt')) return 'pt';
  return 'en';
}

/**
 * Remove tags HTML e resolve entidades comuns do `search[].snippet` da Wikipedia (que vem
 * com `<span class="searchmatch">…</span>`). É saneamento de TEXTO recuperado (infra),
 * NÃO anti-alucinação; o trecho é citado VERBATIM (sem paráfrase) pelo aparato do Rust.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** URL canônica do artigo (a partir do título) — `.../wiki/<Título_com_underscores>`. */
function articleUrl(site: string, title: string): string {
  return `https://${site}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// ── PESQUISA WEB TAVILY (opt-in, BYOK, chave SÓ no corpo) — F4.4 (ADR-0035) ─────────────
//
// 2º backend de pesquisa web (o par web do `ai::research::TavilyProvider`, que é
// `embedded`-only/reqwest e NÃO existe no wasm). Faz um `POST` à `api.tavily.com/search`
// com a chave BYOK NO CORPO (campo `api_key`) — NUNCA na URL/header/log — e mapeia
// `results[]` em `StudyWebSourceInput[]` (o MESMO tipo que `wikipediaSearch` produz), que
// `study_web_prepare`/`study_web_finalize` já ACEITAM. As citações `[W:n]`/`kind="Web"`
// (das URLs) e o `verify` vêm do MESMO Rust `ai-pure` (ZERO DRIFT): esta camada só
// RECUPERA fontes — NADA de anti-alucinação/citação é reimplementado aqui.
//
// PRIVACIDADE / OPT-IN (ADR-0025/ADR-0035): a rede Tavily só ocorre quando o usuário LIGA
// a pesquisa web e informa a chave (session-only, in-memory — perdida no reload, NUNCA
// persistida/logada/em git). A chave viaja SÓ no corpo do POST. O `fetch` é INJETÁVEL (a
// prova headless passa um MOCK; produção usa `globalThis.fetch`).

/** Limite default de fontes Tavily (espelha `DEFAULT_RESEARCH_LIMIT = 4` do core nativo). */
export const DEFAULT_TAVILY_LIMIT = 4;

/** Endpoint público do Tavily (a chave vai no CORPO, nunca na URL). */
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/**
 * Host (`site`) extraído de uma URL — espelha o helper do `TavilyProvider` do core:
 * pega o que vem depois de `://` até o primeiro `/`. String vazia se não houver host.
 */
function hostFromUrl(url: string): string {
  const afterScheme = url.split('://')[1] ?? url;
  return afterScheme.split('/')[0] ?? '';
}

/**
 * Busca fontes no Tavily (BYOK, opt-in) e devolve `StudyWebSourceInput[]` prontas p/
 * alimentar `study_web_prepare`/`study_web_finalize` (o MESMO tipo de `wikipediaSearch`).
 * Espelha a `TavilyProvider::search` do core (rev pinada `04b9b24`, só-leitura):
 *   1) `POST https://api.tavily.com/search`, header `content-type: application/json`,
 *      corpo JSON `{ api_key: <key BYOK>, query, max_results: clamp(1..10), search_depth:
 *      "basic" }` — a **chave vai SÓ no CORPO** (`api_key`), NUNCA na URL/header/log;
 *   2) erro HTTP → lança citando SÓ o status (sem a chave); query vazia → `[]` (sem fetch);
 *   3) mapeia `results[]` → `{ title, url, snippet (=content), site (host da url), fetchedAt }`
 *      (pula item sem `url`). `results` ausente → `[]` (sem throw).
 * As citações `[W:n]`/`kind="Web"` são montadas pelo Rust (das URLs); esta fn só RECUPERA.
 */
export async function tavilySearch(
  fetchImpl: AiFetch,
  key: string,
  query: string,
  _lang: string,
  limit?: number,
): Promise<StudyWebSourceInput[]> {
  const q = query.trim();
  if (q.length === 0) {
    return [];
  }
  // `max_results` = limite alinhado ao core (`limit.clamp(1, 10)`).
  const maxResults = Math.min(10, Math.max(1, limit ?? DEFAULT_TAVILY_LIMIT));

  // A chave BYOK vai SÓ no CORPO (`api_key`) — NUNCA na URL/header/log.
  const res = await fetchImpl(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query: q,
      max_results: maxResults,
      search_depth: 'basic',
    }),
  });
  if (!res.ok) {
    // Cita SÓ o status HTTP; a chave (no corpo) NUNCA entra na mensagem de erro/log.
    throw new Error(`Tavily respondeu HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  const results = (raw as { results?: unknown })?.results;
  if (!Array.isArray(results)) {
    return [];
  }

  const fetchedAt = BigInt(Math.floor(Date.now() / 1000));
  return results
    .map((item): StudyWebSourceInput | null => {
      const it = item as { title?: unknown; url?: unknown; content?: unknown };
      const url = typeof it?.url === 'string' ? it.url : '';
      if (url.length === 0) {
        return null;
      }
      return {
        title: typeof it?.title === 'string' && it.title.length > 0 ? it.title : '(sem título)',
        url,
        snippet: typeof it?.content === 'string' ? it.content : '',
        site: hostFromUrl(url),
        fetchedAt,
      };
    })
    .filter((s): s is StudyWebSourceInput => s != null);
}

/**
 * Busca fontes na Wikipedia (KEYLESS, opt-in) e devolve `StudyWebSourceInput[]` prontas p/
 * alimentar `study_web_prepare`/`study_web_finalize`. Passos:
 *   1) monta a URL da API pública (`action=query&list=search&format=json&origin=*` — o
 *      `origin=*` habilita CORS keyless no browser); a `query` é `encodeURIComponent`;
 *   2) `fetch` (INJETÁVEL) → JSON; erro HTTP → lança (mensagem cita só o status, SEM segredo
 *      — a Wikipedia é keyless, não há segredo);
 *   3) mapeia `query.search[]` → `{ title, url (artigo), snippet (sem HTML), site,
 *      fetchedAt }`. Query vazia/sem `search` → `[]` (sem throw).
 * As citações `[W:n]`/`kind="Web"` são montadas pelo Rust (das URLs); esta fn só RECUPERA.
 */
export async function wikipediaSearch(
  fetchImpl: AiFetch,
  query: string,
  lang: string,
  limit?: number,
): Promise<StudyWebSourceInput[]> {
  const q = query.trim();
  if (q.length === 0) {
    return [];
  }
  const site = `${wikipediaLang(lang)}.wikipedia.org`;
  const srlimit = limit ?? DEFAULT_WIKIPEDIA_LIMIT;
  // API pública KEYLESS: sem chave/header de auth; `origin=*` p/ CORS no browser.
  const url =
    `https://${site}/w/api.php?action=query&list=search&format=json&origin=*` +
    `&srlimit=${srlimit}&srsearch=${encodeURIComponent(q)}`;

  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) {
    // Sem segredo p/ vazar (Wikipedia é keyless); cita só o status HTTP.
    throw new Error(`Wikipedia respondeu HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  const search = (raw as { query?: { search?: unknown } })?.query?.search;
  if (!Array.isArray(search)) {
    return [];
  }

  const fetchedAt = BigInt(Math.floor(Date.now() / 1000));
  return search
    .map((hit): StudyWebSourceInput | null => {
      const h = hit as { title?: unknown; snippet?: unknown };
      const title = typeof h?.title === 'string' ? h.title : '';
      if (title.length === 0) {
        return null;
      }
      return {
        title,
        url: articleUrl(site, title),
        snippet: typeof h?.snippet === 'string' ? stripHtml(h.snippet) : '',
        site,
        fetchedAt,
      };
    })
    .filter((s): s is StudyWebSourceInput => s != null);
}
