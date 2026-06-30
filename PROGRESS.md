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
| F0.5  | 2026-06-29 | App Expo mínimo (SDK 56, expo-router) em `app/` com tela `TextInput`+resultado (sem core); export web compila, `tsc` limpo. Node 25 compat. SDK 56. | `3262f56` |
| (core) | 2026-06-30 | **the-light**: feature `embedded` (default-on) destrava build wasm da lógica pura (branch `feat/core-wasm-feature-gating`, mesclado na `main`). ADR-0005. | `8f66004`† |
| F0.6a | 2026-06-30 | Re-pin do core p/ `8f66004` + matriz de features por alvo (web=puro / nativo=embedded). Build nativo + 5 testes OK; `cargo tree` confirma 0 deps pesadas no wasm. **Bloqueio SQLite-no-WASM resolvido.** | `9f37bc4` |
| F0.6c | 2026-06-30 | Alinhar `uniffi` da fronteira a `=0.31.0` (compat. runtime web do ubrn); fronteira verde (5 testes) + JSI regenera; ADR-0006. Destrava retry da F0.6b. | `7b98644` |
| F0.6b | 2026-06-30 | **Caminho web/WASM fechado**: `ubrn build web` + `gen-bindings-web.sh` → wasm-bindgen; glue `app/web/`; tela ligada; prova headless `parseReference` PT==EN (43/3/16) pelo Rust; `expo export web` ok. ADR-0007. | `1cdde6c` |
| F0.7 | 2026-06-30 | **Alvo iOS fechado**: `ubrn build ios` → Turbo Module JSI; integração Expo (prebuild+New Arch codegen+CocoaPods); run real no simulador iPhone 17/iOS 26.5; prova headless PT==EN (43/3/16) pelo Rust nativo. ADR-0008. | `a6f6797` |
| F0.8 | 2026-06-30 | **Alvo Android fechado**: `ubrn build android` (cargo-ndk→jniLibs) → Turbo Module JNI/JSI; integração Expo (prebuild+autolink+New Arch); run real no emulador headless; prova headless PT==EN (43/3/16) via `adb logcat`. ADR-0009. **Os 3 alvos provados.** | `36af016` |
| F0.9 | 2026-06-30 | **Store nativo provado**: `get_passage` delega ao `the-light-core` (`Store::open`+`EmbeddedSource::passage`); lê João 3:16 do `assets/data/sample.sqlite` versionado (KJV domínio público, gerado via `scripts/gen-sample-db.sh`→`Store::open`). Teste host verde (texto KJV verbatim + 43/3/16). Gating de **corpo** por alvo (web=stub) mantém wasm puro (sem rusqlite) e `ubrn build web` verde. ADR-0010. | `1d16897` |
| F0.10 | 2026-06-30 | **Store web provado**: `getPassage` web em TS — parseReference PELO RUST (wasm) + `queryPassage` espelhando `EmbeddedSource::passage` num `wa-sqlite@1.0.0` (build sync, sem SharedArrayBuffer); persistência OPFS + leitura em VFS de memória hidratado. Tela web exibe o TEXTO do store. Prova headless node verde (KJV verbatim + 43/3/16, texto do store). `expo export web` 0 com wa-sqlite + sample no bundle; sem regressão (F0.6b/F0.7/F0.8/F0.9). ADR-0011/ADR-0012. | `d6e968d` |
| **F0.11** | 2026-06-30 | **🎯 MARCO 0 APROVADO (sign-off humano)** — viabilidade da ponte Rust→Expo provada nos 3 alvos + store nativo/web; Fase 0 concluída. **Fase 1 liberada.** | `aed825d` |
| F1.1 | 2026-06-30 | **Banco bíblico COMPLETO embarcado**: `scripts/gen-bible-db.sh` roda o `xtask import` canônico do the-light (rev pinado `8f66004`) SEM tocá-lo (checkout do cargo + `CARGO_TARGET_DIR` fora) → `assets/data/bible.sqlite` (~27 MB) com KJV (en) + Almeida 1911 (pt), domínio público. Contagens validadas LENDO do banco: kjv=**31102**, alm1911=**31101**, 66 livros/versão, `verses_fts` 62203 (acento-insensível: `MATCH 'ceus'`→384 "céus"). Idempotente (2× estável). Armazenamento: gerar-ignorado (`bible.sqlite`+`.cache/` no .gitignore; `sample.sqlite` segue versionado). ADR-0013. | _pendente_ |
