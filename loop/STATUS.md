# Loop — Board de status

> **Modo autônomo:** o Claude Code (Driver + planner/executor/reviewer) mantém
> esta tabela a cada ciclo. O Guia só audita. Legenda: ⬜ backlog · 🟡 ready ·
> 🔵 in_progress · 🔴 blocked/failed · ✅ aceito · ⛔ gate (HALT p/ sign-off)

Última atualização: 2026-06-29 22:24 UTC · Estado do loop: **rodando (ciclo 1 ok)**
Heartbeat: ver `HEARTBEAT` · HALT: ausente · Próxima tarefa elegível: **F0.1** (após planner semear na queue)

## Fase 0 — Prova da ponte Rust → Expo

| ID | Tarefa | Estado | Depende de | Resultado |
|----|--------|--------|------------|-----------|
| F0.0 | Confirmar toolchain e versões; registrar ADR | ✅ aceito | — | passed (efe334f) |
| F0.1 | Bootstrap do repo + docs de processo (DECISIONS/PROGRESS/.gitignore) | ⬜ | F0.0 | — |
| F0.2 | Crate `core/` com UniFFI compilando (sem lógica) | ⬜ | F0.1 | — |
| F0.3 | `parse_reference` na fronteira + teste | ⬜ | F0.2 | — |
| F0.4 | Script de geração de bindings TS | ⬜ | F0.3 | — |
| F0.5 | App Expo mínimo (expo-router) + tela | ⬜ | F0.1 | — |
| F0.6 | Ligar core no **web (WASM)**: chamar parse_reference | ⬜ | F0.4, F0.5 | — |
| F0.7 | Ligar core no **iOS**: chamar parse_reference | ⬜ | F0.4, F0.5 | — |
| F0.8 | Ligar core no **Android**: chamar parse_reference | ⬜ | F0.4, F0.5 | — |
| F0.9 | Store nativo (`rusqlite`): ler 1 passagem do sample.sqlite | ⬜ | F0.6/7/8 | — |
| F0.10 | Store web (`wa-sqlite`+OPFS): ler 1 passagem | ⬜ | F0.9 | — |
| F0.11 | **Marco 0** (⛔ gate): revisão dos 3 alvos + store; ADR + PROGRESS | ⬜⛔ | F0.9, F0.10 | — |

## Fases seguintes

F1 (leitura offline), F2 (IA BYOK + Gemini), F3 (estudo profundo), F4 (refino)
— ver `IMPLEMENTATION_PLAN.md`. Serão decompostas em `backlog/` conforme a Fase 0
fechar.

## Log de ciclos

| Data | Evento |
|------|--------|
| 2026-06-29 | Loop criado; PROTOCOL.md e backlog da Fase 0 escritos; F0.0 semeada na queue. |
| 2026-06-29 | Migrado p/ **modo autônomo**: subagentes, run-loop.sh, journal/heartbeat/HALT, gate no Marco 0. Guia vira auditor. |
| 2026-06-29 | Ciclo 1: F0.0 executada (executor) e verificada (reviewer) → **passed** (efe334f); arquivada. Lacunas registradas: targets Rust, ubrn, Xcode (F0.7), Android NDK (F0.8). |
