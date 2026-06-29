# Auditoria do loop — papel do Guia

> O Guia **não** roda o loop nem libera tarefas. Ele audita periodicamente se o
> loop autônomo do Claude Code está rodando **corretamente e dentro dos
> princípios**, e só intervém quando há desvio. Este documento é o checklist.

## Quando

Periodicamente (cadência definida com o Renan; padrão: diária) ou sob demanda.
Cada auditoria gera um relatório em `loop/audits/<data>.md`.

## O que ler (somente leitura, exceto intervenção)

- `loop/HEARTBEAT` — quão recente foi o último ciclo.
- `loop/HALT` — existe? qual o motivo?
- `loop/JOURNAL.md` — cadência e desfechos dos últimos ciclos.
- `loop/STATUS.md` — board: o que avançou, o que está 🔴/⛔.
- `loop/done/` e `loop/archive/` — resultados recentes e suas verificações.
- `git log --oneline` — commits batendo com as tarefas aceitas.

## Checklist de saúde

1. **Vivacidade.** O `HEARTBEAT` é recente o suficiente (vs. cadência esperada)?
   Se há `HALT`, o motivo é legítimo (gate/blocked) e não um travamento silencioso?
2. **Progresso real.** O `JOURNAL.md` mostra tarefas avançando (não ciclos
   girando à toa)? Os IDs em `archive/` crescem coerentemente com o plano?
3. **Integridade da verificação.** Cada `result.md` com `passed` cola saída de
   verificação **real** que prova o aceite? (Detectar "passou" sem evidência.)
4. **Aderência aos princípios** (amostragem dos diffs/commits recentes):
   - offline-first preservado (nada essencial exige rede/conta);
   - BYOK: nenhuma chave/segredo em git ou logs;
   - `the-light` intocado (sem commits/edição no repo vizinho);
   - anti-alucinação: texto de versículo vem do store, não do LLM;
   - qualidade verde (fmt/clippy/test; tsc/eslint) antes dos commits.
5. **Fidelidade ao plano.** O que está sendo construído corresponde ao
   `IMPLEMENTATION_PLAN.md`? Há escopo inventado pelo planner?
6. **Gates respeitados.** Marcos (`gate: true`) realmente pararam o loop para
   sign-off, em vez de serem atravessados.
7. **Retentativas.** Falhas (`failed`) respeitam `MAX_RETRIES` (2) antes de HALT;
   nenhuma tarefa em loop infinito de correção.

## Desfechos da auditoria

- **Saudável:** escrever relatório curto em `loop/audits/<data>.md` e avisar o
  Renan em uma linha. Não tocar no loop.
- **Gate aguardando sign-off:** resumir o que o marco entregou, avaliar contra o
  critério, e recomendar ao Renan aprovar (remover `HALT`) ou ajustar.
- **Desvio corrigível:** escrever uma tarefa de correção em `loop/queue/`
  (ID `Gx.y-fix`/`audit-fix`) descrevendo o conserto, e registrar no relatório.
- **Desvio grave / violação de princípio:** manter/escrever `HALT`, explicar o
  risco ao Renan, e propor o caminho. Não deixar o loop seguir sobre base ruim.

## Intervenção (exceção, não rotina)

O Guia só escreve em `loop/queue/` (tarefa de correção) ou em `loop/HALT`
(parar/retomar) quando a auditoria encontra desvio. Nunca implementa código de
produto. Toda intervenção é registrada no relatório de auditoria.
