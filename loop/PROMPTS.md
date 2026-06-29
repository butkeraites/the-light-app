# Prompts para disparar o loop autônomo

> Prontos para copiar e colar. Rode tudo com a CLI `claude` autenticada, **de
> dentro** da pasta `the-light-app/`. Os agentes leem `CLAUDE.md` e
> `loop/PROTOCOL.md` automaticamente.

---

## 0. Maneira mais simples (recomendada) — rodar o loop até parar

Não precisa de prompt: o driver já está num script.

```sh
cd the-light-app
./scripts/run-loop.sh
```

Roda **um ciclo por vez** até aparecer um `loop/HALT`. Variáveis opcionais:
`SLEEP=15 ./scripts/run-loop.sh` (pausa entre ciclos) · `MAX_CYCLES=5 ./scripts/run-loop.sh`
(limita ciclos).

---

## 1. Kickoff autônomo dentro de uma sessão interativa do Claude Code

Se preferir rodar dentro de uma sessão `claude` aberta (sem o script), cole isto:

```text
Você é o Driver do loop de desenvolvimento autônomo deste repositório. Leia
CLAUDE.md e loop/PROTOCOL.md. Em seguida, execute o "Algoritmo de ciclo" do
PROTOCOL.md repetidamente, um ciclo após o outro, usando seus subagentes
(planner, executor, reviewer), até que exista um arquivo loop/HALT. A cada
ciclo: atualize loop/HEARTBEAT, selecione a tarefa elegível (ou acione o planner
se não houver), respeite gates de marco (gate:true => escreva loop/HALT e pare),
acione o executor, depois o reviewer, escreva loop/done/<ID>.result.md, avance e
arquive em caso de passed, e registre uma linha em loop/JOURNAL.md. Nunca relaxe
as regras não negociáveis: diante de qualquer conflito, escreva loop/HALT com o
motivo e pare. Comece agora.
```

---

## 2. Um único ciclo (controle manual, passo a passo)

Para avançar uma tarefa de cada vez e inspecionar entre uma e outra:

```text
Você é o Driver do loop. Leia CLAUDE.md e loop/PROTOCOL.md e execute EXATAMENTE
UM ciclo do "Algoritmo de ciclo": heartbeat; selecionar a tarefa elegível (ou
acionar o planner se não houver); se for gate:true, escrever loop/HALT e parar;
senão acionar o executor, depois o reviewer; escrever o resultado em loop/done/;
avançar/arquivar ou escrever loop/HALT conforme o desfecho; registrar uma linha
em loop/JOURNAL.md. Não execute mais de um ciclo. Ao terminar, me diga o que foi
feito e qual a próxima tarefa elegível.
```

---

## 3. Acionar um subagente isolado

### Planner (gerar/decompor tarefas na queue)
```text
Use o subagente "planner" para decompor a próxima fase pendente do
IMPLEMENTATION_PLAN.md em tarefas atômicas e escrevê-las em loop/queue/ no
formato do PROTOCOL.md, com depends_on corretos e gate:true nos marcos. Atualize
loop/STATUS.md. Não implemente código.
```

### Executor (implementar a tarefa elegível)
```text
Use o subagente "executor" para implementar a tarefa elegível atual da
loop/queue/ (a de menor ID com status ready e dependências aceitas). Siga o
objetivo e as restrições da tarefa, rode os portões de qualidade e faça commit
prefixado com o ID. Não pegue outra tarefa.
```

### Reviewer (verificar e escrever o resultado)
```text
Use o subagente "reviewer" para verificar de forma independente a tarefa que o
executor acabou de implementar: rode o(s) comando(s) de verificação, confira cada
item do critério de aceite e a aderência às regras não negociáveis, e escreva
loop/done/<ID>.result.md com passed/failed/blocked e a saída real da verificação.
```

---

## 4. Retomar depois de um HALT

Quando o loop parou (gate de marco, bloqueio resolvido, falha corrigida):

```text
Leia loop/HALT e loop/STATUS.md para entender por que o loop parou. Se o motivo
já foi resolvido (a decisão foi tomada, a credencial/ferramenta foi provida, ou o
marco foi aprovado), apague o arquivo loop/HALT, registre a retomada em
loop/JOURNAL.md, e então execute o "Algoritmo de ciclo" do PROTOCOL.md
repetidamente até o próximo HALT. Se o motivo NÃO foi resolvido, não remova o
HALT: explique o que ainda falta.
```

> Dica: para destravar um gate de marco, primeiro confira a entrega do marco
> (ou peça a auditoria do Guia). Só então retome.

---

## 5. Auditoria manual (papel do Guia) — opcional

A auditoria diária já está agendada, mas para rodar sob demanda:

```text
Aja como o Guia/auditor (não implemente código). Siga o checklist de loop/AUDIT.md:
leia loop/HEARTBEAT, loop/HALT, loop/JOURNAL.md, loop/STATUS.md, os resultados
recentes em loop/done/ e archive/, e git log --oneline -20. Avalie vivacidade,
progresso real, integridade da verificação e aderência aos princípios. Escreva um
relatório curto em loop/audits/<data>.md e me dê um resumo de 1–3 linhas.
```

---

## Pré-requisitos (uma vez)

- CLI `claude` instalada e autenticada.
- Targets Rust e ferramentas do Expo — isso é exatamente o que a tarefa **F0.0**
  verifica no primeiro ciclo. Se algo faltar, o loop dará `blocked`/`HALT` com a
  lista do que instalar (comportamento esperado, não erro).
- As permissões de execução estão em `.claude/settings.json` (já bloqueia
  `git push` e qualquer acesso a `../the-light`).
