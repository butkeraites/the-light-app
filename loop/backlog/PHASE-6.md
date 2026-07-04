# Fase 6 — Verificação de uso real + completude (ciclo automatizado via loop)

> Semeada em 2026-07-04 após aprovação humana do plano (`~/.claude/plans/nested-popping-origami.md`).
> **Motivo:** o loop validava só HEADLESS (Node); a leitura web ficou quebrada por 3 ciclos sem
> nenhum gate reprovar (F5.36/F5.38/F5.39) — a suíte roda sobre `MemoryVFS`/in-memory e NUNCA toca
> o runtime real do browser (OPFS, fetch de asset do Metro, wasm-instantiate, expo-router). Este
> ciclo constrói primeiro um **guard de smoke em browser REAL** (puppeteer dev+dist) ligado ao loop
> e endurece os pontos frágeis; depois completa as features de IA já verificadas por esse guard.

## Decisões humanas (aprovadas)
- **Ordem:** verificação primeiro → features de IA verificadas pelo guard → polish de dados.
- **Chaves de IA no web:** seguem **só-de-sessão** (ADR-0025), explicitado na tela de Ajustes.
- **IA no browser:** habilitar web com rótulos honestos por provedor + header opt-in da Anthropic
  (`anthropic-dangerous-direct-browser-access`); Ollama-web = "requer config local"; nativo faz
  todos; **sem proxy**. ADR novo.

## Tarefas (ordem: Trilha 1 → 2 → 3)

**Trilha 1 — Verificação real (fundação):**
| ID | Título | Autônomo? |
|----|--------|:--:|
| F6.1 | Harness de smoke em browser real (`app/web/__browser__/`, dev+dist) + scripts + puppeteer-core + auto-prova | sim |
| F6.2 | Asserções de fluxos críticos (abrir capítulo, paralelo, busca+xref, notas-reload+anônimo, planos, export/import, IA-reachability) em dev E dist | sim |
| F6.3 | Endurecer R1 (WasmGate/wasm.web.ts: erro visível + retry, não spinner infinito; byte-fetch se dist quebrar) | sim |
| F6.4 | Guard de staleness do DB nativo no upgrade (`ensureReadingDb` versão/hash) + self-test `TLA_DBUP` | sim (run device-gated) |
| F6.5 | Paridade on-device Android (`run-android-selftest.sh` = bateria `TLA_*` do iOS + `TLA_DBUP`) | escrever sim; rodar device |

**Trilha 2 — Completude de IA (verificada pelo harness):**
| ID | Título | Autônomo? |
|----|--------|:--:|
| F6.6 | Tela de Ajustes/Chaves (`app/app/settings.tsx`) + reroute dos CTAs de `AiProviderNotice` → `/settings` + i18n `settings.*` | sim |
| F6.7 | Des-mockar Study & Chat (seletor de provedor + `getKey` sob demanda; mock = default offline) | sim (resposta real = BYOK humano) |
| F6.8 | CORS honesto + header browser da Anthropic + rótulos web-capaz por provedor + ADR | sim (CORS real = browser+chave) |

**Trilha 3 — Dados/perf (menor prioridade):**
| ID | Título | Autônomo? |
|----|--------|:--:|
| F6.9 | Léxico: popular `morph_legend` (0 linhas hoje) + expandir `LEXICON_BOOKS` incremental; re-baseline de bytes | sim |
| F6.10 | (opcional) AiProviderNotice lazy · split `passage.web` + correção ADR-0040 · a11y micro · split nativo | sim |

## Fora (gate humano)
F5.27 Drive real (client-id GCP) · PR de doc ao `the-light` · resposta real de LLM/CORS real (chave BYOK) ·
picker de import nativo (dep nova + rebuild) · léxico completo 90MB / download parcial web (produto) ·
persistência cifrada de chave web (só se pedido).

## Guard-chave (auto-prova da F6.1)
Reverter temporariamente o fix `locateFile` (F5.39) em `sqlite-reading-opfs.web.ts` → `test:web:smoke`
fica VERMELHO enquanto todos os `test:web:*` seguem verdes. Prova que o guard pega o que o headless perde.

Próximo ADR livre = **ADR-0058**.

## Achado pela verificação (F6.2) — bug de produto a corrigir
- **F6.11 — import de backup em OPFS vazio (fresh install) quebra.** `app/web/userdata-opfs.web.ts`
  L37-38 chamam `getDirectoryHandle(OPFS_ROOT_DIR/OPFS_USERDATA_DIR, {create:false})` SEM guarda →
  numa OPFS vazia lança `NotFoundError` em vez de "ausente→null" (o caminho gracioso de readFile/
  deleteFile via `resolveParent(...,false)`). Quebra "importar backup numa instalação limpa". Fix:
  guardar L37-38 (try/catch → null/empty) + o smoke passa a exercitar o import em OPFS vazia.
  Achado pelo harness da F6.2 (round-trip provado no contexto principal; caminho de OPFS-vazia não).
