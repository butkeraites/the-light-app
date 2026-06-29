#!/usr/bin/env bash
# Driver do loop autônomo do The Light App.
# Roda o Claude Code headless, UM ciclo por vez, repetindo até um HALT.
# Cada ciclo é uma sessão limpa; todo o estado vive em arquivos (loop/).
#
# Uso:
#   ./scripts/run-loop.sh            # roda até HALT ou Ctrl-C
#   MAX_CYCLES=10 ./scripts/run-loop.sh
#   SLEEP=15 ./scripts/run-loop.sh
#
# Requisitos: CLI `claude` instalada e autenticada.

set -euo pipefail
cd "$(dirname "$0")/.."

LOOP_DIR="loop"
SLEEP="${SLEEP:-10}"
MAX_CYCLES="${MAX_CYCLES:-0}"   # 0 = ilimitado
CYCLE=0

CYCLE_PROMPT='Você é o DRIVER do loop autônomo. Leia loop/PROTOCOL.md e CLAUDE.md e
execute EXATAMENTE UM ciclo do "Algoritmo de ciclo": heartbeat, selecionar a
tarefa elegível (ou acionar o subagente planner se não houver), respeitar gates
de marco (gate:true => escrever loop/HALT e parar), acionar o subagente executor,
depois o reviewer, escrever o resultado em loop/done/, avançar/arquivar ou
escrever loop/HALT conforme o desfecho, e registrar uma linha em loop/JOURNAL.md.
Não execute mais de um ciclo. Não relaxe regras não negociáveis: em conflito,
escreva loop/HALT em vez de improvisar.'

echo "[run-loop] iniciando. SLEEP=${SLEEP}s MAX_CYCLES=${MAX_CYCLES}"
while true; do
  if [ -f "${LOOP_DIR}/HALT" ]; then
    echo "[run-loop] HALT presente — parando."
    echo "  motivo: $(head -n1 "${LOOP_DIR}/HALT")"
    break
  fi

  CYCLE=$((CYCLE+1))
  if [ "${MAX_CYCLES}" -ne 0 ] && [ "${CYCLE}" -gt "${MAX_CYCLES}" ]; then
    echo "[run-loop] MAX_CYCLES atingido — parando."
    break
  fi

  echo "[run-loop] ciclo ${CYCLE} — $(date '+%Y-%m-%d %H:%M:%S')"
  # Sessão limpa por ciclo; permissões vêm de .claude/settings.json.
  claude -p "${CYCLE_PROMPT}" --permission-mode acceptEdits || {
    echo "[run-loop] claude retornou erro — registrando HALT."
    echo "driver: claude saiu com erro no ciclo ${CYCLE} em $(date)" > "${LOOP_DIR}/HALT"
    break
  }

  sleep "${SLEEP}"
done
echo "[run-loop] encerrado após ${CYCLE} ciclo(s)."
