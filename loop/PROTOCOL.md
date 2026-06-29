# Loop de desenvolvimento autônomo — Protocolo

> O **Claude Code roda este loop sozinho**, com seus próprios subagentes
> (Planner → Executor → Reviewer), avançando por dependências sem esperar
> aprovação humana a cada tarefa. O **Guia** (agente externo) não fica no caminho:
> atua como **auditor periódico** que verifica a saúde do loop e intervém só
> quando algo sai dos trilhos. Este arquivo é o contrato. Todos os agentes o leem.

## Modelo de operação

```
            ┌──────────────────────── Claude Code (autônomo) ───────────────────────┐
            │                                                                        │
   backlog/ │   Planner  ──►  queue/<ID>.task.md  ──►  Executor  ──►  Reviewer       │
   (plano)  │   (decompõe)        (pronta)           (implementa)    (verifica)      │
            │       ▲                                                    │           │
            │       └──────────────  done/<ID>.result.md  ◄─────────────┘           │
            │                              │                                         │
            │                    avança p/ próxima tarefa elegível (deps OK)         │
            │                              │                                         │
            │              ┌── gate de marco OU blocked/failed ──► escreve HALT ─────┼──► espera
            └──────────────┴────────────────────────────────────────────────────────┘
                                           │
                              JOURNAL.md + HEARTBEAT (a cada ciclo)
                                           │
                                           ▼
                            [Guia] auditoria periódica lê estado,
                            reporta saúde, intervém só se preciso
```

## Papéis

- **Planner (subagente do Claude Code):** lê `IMPLEMENTATION_PLAN.md` e o
  `backlog/`, decompõe a próxima fase em tarefas atômicas com `depends_on`, e as
  escreve em `queue/` (status `ready`) quando suas dependências já foram aceitas.
- **Executor (subagente):** implementa a tarefa elegível, faz commit (prefixo com
  o ID), roda a verificação.
- **Reviewer (subagente):** confere o critério de aceite e a verificação de forma
  independente do Executor; decide `passed` / `failed`, e escreve o
  `done/<ID>.result.md`.
- **Driver (sessão principal do Claude Code):** orquestra um **ciclo** por
  invocação (ver "Algoritmo de ciclo"), mantém `JOURNAL.md` e o heartbeat, e
  escreve `HALT` quando precisa parar.
- **Guia (auditor externo, eu):** NÃO libera tarefas. Periodicamente lê o estado
  do loop (`STATUS.md`, `done/`, `JOURNAL.md`, git log, `HALT`) e produz um
  relatório de saúde em `loop/audits/`. Intervém apenas quando há desvio (ver
  `AUDIT.md`).

## Estrutura de pastas

```
loop/
├── PROTOCOL.md        # este contrato
├── STATUS.md          # board do progresso (o Driver mantém)
├── JOURNAL.md         # log append-only: 1 linha por ciclo (o Driver escreve)
├── HEARTBEAT          # timestamp do último ciclo ativo (o Driver toca)
├── HALT               # existe só quando o loop parou; contém o motivo
├── queue/             # tarefas prontas (Planner escreve)
├── done/              # resultados (Reviewer escreve)
├── backlog/           # tarefas futuras redigidas (Planner)
├── archive/           # tarefas + resultados aceitos (Driver move p/ cá)
└── audits/            # relatórios de auditoria do Guia
```

## Algoritmo de ciclo (o Driver executa UM ciclo por invocação)

1. **Checar parada.** Se `loop/HALT` existe, não faça nada (já parado). Sair.
2. **Heartbeat.** Atualize `loop/HEARTBEAT` com o timestamp atual.
3. **Selecionar tarefa elegível.** Uma tarefa é elegível se `status: ready` e
   todas as `depends_on` estão **aceitas** (resultado `passed` arquivado). Entre
   as elegíveis, pegue a de menor ID. Se nenhuma existir:
   - Se há fase pendente no plano, acione o **Planner** para decompor a próxima
     fase em `queue/` e encerre o ciclo (a próxima invocação executa).
   - Se o plano acabou, escreva `HALT` com motivo "plano concluído". Sair.
3. **Gate de marco.** Se a tarefa elegível é um **gate** (campo `gate: true`,
   ex.: revisão de Marco/Fase), **não** execute autonomamente: escreva `HALT` com
   motivo "aguardando sign-off do marco <ID>" e pare. Marcos são pontos de
   decisão humana/auditoria.
4. **Executar.** Marque a tarefa `in_progress`. Acione o **Executor**.
5. **Verificar.** Acione o **Reviewer** (independente). Rode o comando de
   verificação. Escreva `done/<ID>.result.md`.
6. **Avançar ou escalar:**
   - `passed`: commit, mova tarefa+resultado para `archive/`, atualize `STATUS.md`
     e `PROGRESS.md`, registre no `JOURNAL.md`. Próximo ciclo segue.
   - `failed`: incremente o contador de tentativas no frontmatter da tarefa. Se
     `< MAX_RETRIES` (padrão **2**), gere uma tarefa de correção `<ID>-fixN` e
     continue. Se `>= MAX_RETRIES`, escreva `HALT` com motivo "falha persistente
     em <ID>".
   - `blocked`: escreva `HALT` com o motivo (decisão/credencial/ferramenta
     faltando). Pare.
7. Registre o ciclo em `JOURNAL.md` e encerre.

## Condições de HALT (quando o loop para e espera humano/auditoria)

O loop **deve** parar e escrever `loop/HALT` (com motivo legível) quando:

- Atinge um **gate de marco** (`gate: true`) — ex.: fim da Fase 0 (viabilidade).
- Uma tarefa fica **blocked** (falta decisão, chave de API, ferramenta, ou exige
  algo irreversível).
- Uma tarefa **falha** mais que `MAX_RETRIES` vezes.
- Precisaria **modificar o repositório `the-light`** (só via PR + ADR — decisão
  humana).
- Precisaria de **segredos** ou de qualquer ação fora do escopo offline-first/BYOK.
- Detecta violação de princípio que não consegue resolver sozinho.

Para **retomar** após um HALT: o humano (Renan) ou o Guia resolve o motivo,
remove/edita o arquivo `HALT`, e o loop volta a rodar no próximo ciclo.

## Formato do arquivo de TAREFA (`queue/<ID>.task.md`)

```markdown
---
id: F0.3
title: Implementar parse_reference na fronteira UniFFI
phase: 0
status: ready            # ready | in_progress
gate: false              # true => marco: HALT para sign-off, não roda sozinho
depends_on: [F0.2]
attempts: 0
created_by: planner
created_at: 2026-06-29
---

## Objetivo
## Contexto / arquivos
## Passos sugeridos
## Critério de aceite        (checklist objetivo)
## Comando(s) de verificação (bloco sh)
## Restrições                (regras rígidas relevantes)
```

## Formato do arquivo de RESULTADO (`done/<ID>.result.md`)

```markdown
---
id: F0.3
status: passed           # passed | blocked | failed
commit: <hash ou n/a>
reviewer: reviewer
finished_at: 2026-06-29
---

## Resumo
## Critério de aceite      (marcado, com como foi satisfeito)
## Saída da verificação    (saída real do comando)
## Decisões / ADRs
## Bloqueios / perguntas   (o que exige humano/Guia — ou "nenhuma")
```

## Regras herdadas (não negociáveis)

Valem todas as regras da seção 0 do `IMPLEMENTATION_PLAN.md`: offline-first,
BYOK, licenciamento, anti-alucinação, não modificar `the-light` (PR + ADR),
qualidade por tarefa (`fmt`/`clippy -D warnings`/`test`; `tsc`/`eslint`). O loop
autônomo **nunca** relaxa essas regras para "fazer progredir": diante de
conflito, ele para (HALT) em vez de improvisar.
