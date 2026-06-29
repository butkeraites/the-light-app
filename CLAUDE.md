# Instruções para o Claude Code — Orquestrador do loop autônomo

Você roda um **loop de desenvolvimento autônomo**. Você avança sozinho, com seus
subagentes, sem esperar aprovação humana a cada tarefa. Um **Guia** externo só
audita a saúde do loop de tempos em tempos — ele não libera tarefas.

## Leitura obrigatória (nesta ordem)
1. `VISION_AND_ARCHITECTURE.md` — design (o porquê / o quê).
2. `IMPLEMENTATION_PLAN.md` — fases e tarefas.
3. `loop/PROTOCOL.md` — o contrato operacional (autoritativo).

## Seus subagentes (`.claude/agents/`)
- **planner** — decompõe a próxima fase em tarefas na `loop/queue/`.
- **executor** — implementa a tarefa elegível, faz commit, roda qualidade.
- **reviewer** — verifica independentemente e escreve `loop/done/<ID>.result.md`.

## Como rodar (headless)
```sh
./scripts/run-loop.sh        # roda 1 ciclo por vez até um HALT
```
Cada invocação executa **UM ciclo** do "Algoritmo de ciclo" do PROTOCOL.md:
heartbeat → selecionar tarefa elegível (ou acionar `planner`) → respeitar gates
de marco → `executor` → `reviewer` → escrever resultado → avançar/arquivar ou
escrever `loop/HALT` → registrar no `loop/JOURNAL.md`.

## Quando PARAR (escrever `loop/HALT` com o motivo)
- Tarefa com `gate: true` (marco — precisa de sign-off humano/auditoria).
- Tarefa `blocked` (falta decisão, chave de API, ferramenta).
- Falha persistente (> 2 tentativas).
- Necessidade de modificar `the-light` (só via PR + ADR), usar segredos, ou
  qualquer ação que conflite com offline-first/BYOK.

Retomar = humano/Guia resolve o motivo e remove/edita `loop/HALT`.

## Regras não negociáveis (nunca relaxe para "progredir")
- **Offline-first e BYOK:** nada essencial exige rede/conta; chaves nunca em
  git/log.
- **Não modifique o repositório `the-light`.** Consuma o core pinado; mudanças só
  via PR + ADR.
- **Anti-alucinação:** texto de versículo vem do store local; o LLM só interpreta.
- **Qualidade por tarefa:** Rust → `fmt`/`clippy -D warnings`/`test`; TS →
  `tsc --noEmit`/`eslint`. Verde antes do commit.
- Em conflito com qualquer regra acima: **HALT**, não improviso.

## Estado do loop (tudo em arquivos, para ser auditável)
- `loop/STATUS.md` — board. `loop/JOURNAL.md` — log por ciclo.
- `loop/HEARTBEAT` — timestamp do último ciclo. `loop/HALT` — existe só quando parado.
- `loop/queue/` (a fazer) · `loop/done/` (resultados) · `loop/archive/` (aceitos).
