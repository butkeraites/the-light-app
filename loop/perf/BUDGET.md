# Orçamento de performance do bundle WEB — TRAVADO (F5.19 · ADR-0047)

> **SAÍDA do workstream perf.** Este é o ponto em que "performance web" vira **objetivo e
> durável**: um orçamento (budget) travado + uma guarda de regressão wired. A decisão canônica
> está em `DECISIONS.md` → **ADR-0047**. Contrato legível por máquina:
> `loop/perf/web-bundle-budget.json`. Métrica/baseline: `loop/perf/web-bundle-baseline.json`.
> Serving/transfer: `loop/perf/SERVING.md` (ADR-0045).

## A guarda (como rodar)

```sh
# GUARDA OFICIAL (completa: export + enforcer + cross-check do lock)
cd app && npm run test:web:perf-budget          # → scripts/check-web-bundle-budget.sh
# ou direto:
./scripts/check-web-bundle-budget.sh

# Rápido (SÓ o cross-check do lock, reusa a baseline — p/ CI/re-checagem sem re-export):
./scripts/check-web-bundle-budget.sh --check-only
```

Sai `0` só se **(1)** o enforcer `scripts/measure-web-bundle.sh` passa (export web offline +
pré-compressão .gz/.br zero-drift + budget) **e (2)** a baseline produzida bate byte-a-byte com
o contrato congelado. Qualquer breach → exit `!= 0` com o campo ofensor + delta.

### Duas camadas

1. **Enforcer** (`measure-web-bundle.sh`, F5.3/6/9/12/15/17): FALHA se um asset byte-estável
   mudar de conteúdo, o entry-JS eager sair da banda `nominal±tolerância`, o `moduleCount`
   eager mudar, ou um asset REMOVIDO reaparecer.
2. **Lock cross-check** (`check-web-bundle-budget.sh`, F5.19): compara a baseline contra
   `web-bundle-budget.json` (contrato CONGELADO). Detecta drift entre o enforcer e o contrato —
   ex.: um re-baseline não documentado (alguém mexeu no `BUDGET` de `measure-web-bundle.sh` sem
   atualizar o lock).

## Limites FINAIS travados

| grandeza | limite travado | tipo | origem |
| --- | ---: | --- | --- |
| frontier `.wasm` (raw) | **1.223.324 B** | EXATO | F5.6 (release + wasm-opt) + **F5.10** (geração de planos na wasm) |
| frontier `.wasm` transfer | gzip 440.559 · br 319.679 | EXATO | F5.17 + **F5.10** |
| `reading-lite.sqlite` (leitura) | **4.530.176 B** | EXATO | F5.15 (léxico off-path) |
| `lexicon-sample.sqlite` (on-demand) | **9.502.720 B** | EXATO | F5.15 (fora do 1º paint) |
| `wa-sqlite` FTS5 `.wasm` | **666.267 B** | EXATO | F1.14 (vendorado) |
| entry-JS eager `moduleCount` | **839** | EXATO | F5.9/12/15 + F5.18 + **F5.10** (ver abaixo) |
| entry-JS eager raw | 1.324.809 ± 1.024 B | nominal±tol | F5.17 + **F5.10** (centro do flutter) |
| entry-JS eager gzip | 335.273 ± 2.048 B | nominal±tol | F5.17 + **F5.10** |
| entry-JS eager brotli | 264.632 ± 1.024 B | nominal±tol | F5.17 + **F5.10** |
| **1º paint transfer** (headline) | **gzip 335.273 · br 264.632** | nominal | F5.17 + **F5.10** |
| assets REMOVIDOS (não podem voltar) | `waSqliteNpm`, `sampleDb`, `readingSampleCombined` | guard | F5.12/F5.15 |

**Determinismo (honesto):** os assets content-addressed são BYTE-ESTÁVEIS → EXATOS. O entry-JS
eager NÃO é byte-determinístico (Metro renumera os módulos em ordem de grafo async → flutter
~122 B raw / ~1,7 KB gzip entre runs) → gravado como `moduleCount` EXATO + bytes `nominal ±
tolerância`, re-verificado a cada run. Por isso a baseline JSON é reprodutível byte-a-byte.

## Antes → depois (o que o workstream perf entregou)

| item | baseline (pré-otimização) | travado (pós) | ganho |
| --- | ---: | ---: | --- |
| frontier `.wasm` (raw) | 4.244.884 B (DEBUG) | 1.198.888 B | **−71,8 %** (F5.6) |
| caminho de LEITURA (1º capítulo) | 14.409.728 B (combinado c/ léxico) | 4.530.176 B (`reading-lite`) | **−9,88 MB** (F5.15) |
| léxico (~9 MB) | eager no caminho de leitura | ON-DEMAND (só estudo/léxico) | fora do 1º paint (F5.15) |
| assets mortos (F0.10) | npm wa-sqlite 558.343 + sample 131.072 | removidos | **−689.415 B** (F5.12) |
| entry-JS eager `moduleCount` | 856 | 838 | **−18** (F5.9/12/15) |
| entry-JS eager raw | 1.448.032 B | ~1.314.270 B | **−9,2 %** (F5.9/12) |
| entry-JS eager gzip | 372.625 B | ~332.884 B | **−10,7 %** (F5.9/12) |
| 1º paint OVER-THE-WIRE | — (não medido) | ~332 KB gzip / ~262 KB br | medido/travado (F5.17) |

Marcos do entry-JS eager `moduleCount`: **856** (F5.3) → 844 (F5.9 code-split) → 834 (F5.12
dead-assets + split `passage.web`) → 837 (F5.15 glue léxico on-demand) → 838 (F5.18) → **839**
(F5.10 paridade web de planos).

### Re-baseline F5.18 → 838 (registrado por esta guarda)

Ao travar o orçamento, a guarda pegou uma drift ESTRUTURAL que passara sem ser vista: a **F5.18**
(ADR-0046) extraiu os tokens de cor p/ o módulo PURO novo `app/lib/themePalettes.ts` (importado
por `app/lib/theme.ts`, eager no 1º paint) → **+1 módulo eager** (837 → 838, git-provável e
determinístico em 2+ exports). A F5.18 só rodou `expo export` (exit 0), **não** o
`measure-web-bundle.sh`, então a mudança não foi vista. Re-baseline DELIBERADO/justificado: os
bytes NÃO mudaram de forma relevante (o wrapper `__d(...)` extra ~600 B raw é absorvido pela banda
±1024; centros gzip/brotli inalterados). É exatamente a classe de regressão que esta guarda passa a
travar — daqui pra frente `test:web:perf-budget` roda junto da suíte web e a pega.

### Re-baseline F5.10 → 839 + wasm +24 KB (paridade web dos planos; ADR-0037/0050)

Re-baseline DELIBERADO/justificado (autorizado pelo Driver/loop owner), com DUAS partes:

1. **frontier `.wasm` 1.198.888 → 1.223.324 B (+24.436, +2,0 %; gzip 430.849→440.559, br
   311.729→319.679).** A GERAÇÃO de planos de leitura virou cfg-free/PURA (ADR-0037, core @
   `225b8c9`) e passou a compilar na wasm da fronteira sob `ai-pure` (`userdata::plans` + o parse
   de data `chrono`), realizando a paridade web. NÃO é regressão: é a feature entrando no grafo
   wasm (determinístico em 3 exports). O PROGRESSO segue app-side em OPFS (chunk async `plans-fs`),
   fora do 1º paint.
2. **`moduleCount` eager 838 → 839 (+1 módulo eager EXATO).** A tela `/plans` deixou de degradar
   no web (o `PlansWebNotice` saiu) e monta a UI real (geração + progresso OPFS) → +1 módulo eager
   de `plans/index`. Os bytes do entry foram re-centrados no centro do flutter do Metro medido em 3
   exports (raw 1.324.748–1.324.870; gzip 334.428–336.118; br 264.620–264.644); tolerâncias
   inalteradas (magnitude do flutter igual). Baseline JSON byte-estável em 3 runs.

Re-baseline SÓ quando a mudança do app é **intencional/aceita** (não uma regressão acidental):

1. Confirme a intenção (ADR/tarefa) — code-split, novo build de asset, extração de módulo, etc.
2. `./scripts/measure-web-bundle.sh` → leia os valores VIVOS.
3. Atualize **AMBOS**: a const `BUDGET` em `scripts/measure-web-bundle.sh` **e** os campos em
   `loop/perf/web-bundle-budget.json` (`moduleCount` EXATO; bytes de asset content-addressed
   EXATOS; entry-JS = re-centre o `nominal` no centro do flutter medido em ≥2 exports; mantenha a
   `tolerance`). O cross-check FALHA se você atualizar só um dos dois — é o "speed-bump" proposital.
4. Registre o porquê num ADR (como ADR-0047) e no commit.

`moduleCount` mudou = mudança ESTRUTURAL (code-split / módulo eager novo). Bytes de asset estável
mudaram = o conteúdo do asset mudou (novo build wasm/DB). Offline-first: a guarda é local, sem rede.
