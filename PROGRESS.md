# PROGRESS.md — Log de execução do `the-light-app`

> Uma linha por tarefa concluída e verde (regra 9 da seção 0 do
> `IMPLEMENTATION_PLAN.md`): ID · data · resumo de 1 linha · commit. O log é
> append-only e serve de trilha auditável do loop autônomo.

| ID    | Data       | Resumo                                                                 | Commit    |
| ----- | ---------- | --------------------------------------------------------------------- | --------- |
| F0.0  | 2026-06-29 | Confirmou toolchain e registrou versões do ambiente (sem código de produto). | `efe334f` |
| F0.1  | 2026-06-29 | Bootstrap da estrutura do repo + docs de processo (DECISIONS/PROGRESS/.gitignore). | `595c70c` |
| F0.2  | 2026-06-29 | Crate `core/` (the-light-app-core) com fronteira UniFFI trivial (`ping`) compilando; uniffi 0.31.2, modo library. | `7b922eb` |
| F0.3  | 2026-06-29 | `parse_reference` na fronteira UniFFI delegando ao `the-light-core` (git dep pinada rev `0888ac0`, core v1.2.0); "Jo 3.16"=="John 3:16". | `9881c72` |
| F0.4  | 2026-06-29 | Script reproduzível `gen-bindings.sh` gera bindings TS via `ubrn` 0.31.0-3 (ADR-0004); `bindings/*.ts` com `parseReference`/`ping`/tipos. | `e19064a` |
