# Loop — Journal (append-only)

> Uma linha por ciclo do Driver. Formato:
> `<timestamp> · ciclo <n> · <ação> · tarefa <ID> · <desfecho>`
> O Guia (auditor) lê este journal para aferir cadência e saúde do loop.

2026-06-29 20:57 UTC · ciclo 0 · loop inicializado pelo Guia · tarefa F0.0 pronta na queue · aguardando primeiro ciclo do Driver
2026-06-29 22:24 UTC · ciclo 1 · executor+reviewer em F0.0 (descoberta de toolchain) · tarefa F0.0 · passed (efe334f), arquivada · lacunas futuras: targets Rust/ubrn (instaláveis), Xcode→F0.7 e Android NDK→F0.8 (setup humano)
