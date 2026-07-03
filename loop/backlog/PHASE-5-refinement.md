# Fase 5 — Varredura de refinamento (follow-ups abertos → F5.28+)

> Semeada em 2026-07-03 após o humano deferir a F5.27 (validação real do Drive na GCP) e
> pedir para o loop **seguir**. O plano (Fases 0–5) está construído; esta varredura (workflow
> `fase5-refinement-sweep`, 4 sweeps paralelos + síntese) levantou os follow-ups AUTÔNOMOS
> ainda abertos (offline, sem tocar o `the-light@225b8c9`, sem segredo). Ordem = mais valor
> primeiro (completude i18n/a11y → descobribilidade → abertura/docs).

## Tarefas (todas gate:false, autônomas, offline)

| ID | Título | Esforço | Origem |
|----|--------|:------:|--------|
| F5.28 | Localizar nomes das cores de destaque via `t()` (parar de vazar PT no leitor de tela EN) | S | follow-up F5.16; `highlightColors.ts:26-29` |
| F5.29 | Corrigir o `Text` de resultado da Home que esconde o conteúdo do leitor de tela | S | `app/app/index.tsx:166-173` |
| F5.30 | Expor links /read, /search, /plans na home **web** (hoje só por URL digitada) | S | `index.tsx:189-228`; ADR-0050 |
| F5.31 | Seletor de tradução na Busca (hoje fixo em KJV; store também tem Almeida 1911) | S | `search/index.tsx:25-27,98` |
| F5.32 | Rolar/destacar o versículo alvo quando o Reader recebe `?verse=N` (busca/xref caem no topo hoje) | M | `read/[book]/[chapter].tsx:74` |
| F5.33 | Seletor tri-estado de tema (claro/escuro/seguir-sistema) — capacidade já existe, sem UI | S | ADR-0043; `theme.ts:51-113` |
| F5.34 | README real (propósito · offline-first/BYOK · anti-alucinação · licenças · como rodar) — subsume NOTICE | M | `README.md` (15 bytes) |
| F5.35 | Tela in-app Sobre/Créditos/Licenças (KJV, Almeida 1911, OpenBible CC-BY, STEP CC BY 4.0) | M | grep about/credits vazio |

## Excluídas (com motivo)

- **Import por arquivo no NATIVO (expo-document-picker)** — exige dep nativa nova + rebuild nativo; não verificável pelos guardas headless web; nativo já importa offline via colar + Share.
- **Split reading-lite/léxico on-demand no NATIVO** — perf só-nativo (L); depende do self-test on-device (não roda pelos guardas web).
- **Popular o `related`/xref RAG do estudo web (hoje `[]`)** — válido mas baixo valor visível (muda contexto do LLM no web, nunca expõe versículo); adiado.
- **Snooze/histórico dos lembretes locais** — feature aditiva nova, não fecha lacuna de comportamento existente; adiado.
- **Passphrase E2E do snapshot de sync** — prematuro: o único consumidor (push ao Drive) está atrás do gate F5.27 deferido.
- **LICENSE do repositório** — **não-autônomo**: exige DECISÃO humana de qual licença → HALT; fora de escopo desta varredura autônoma.
- Duplicatas colapsadas: cores de destaque (2 sweeps→F5.28), nav web (2 sweeps→F5.30), NOTICE (dobrado no README F5.34).

## Nota

Nenhuma toca o `the-light` (`225b8c9`), nenhuma usa segredo/conta/rede real, todas verificáveis
pelos guardas existentes (`tsc`, `test:web:*`, `test:i18n`/`i18n-coverage`, `test:web:contrast`,
`test:a11y-scan`, `expo export --platform web`). Próximo ADR livre = **ADR-0055**.
Quando o humano fornecer o client-id da GCP → retomar **F5.27** (fechamento da Fase 5).
