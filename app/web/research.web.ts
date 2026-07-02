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
