# The Light App

An **offline-first, bilingual (PT/EN) Bible-study app** for Web, iOS and Android.
It puts a shared **Rust core** (the [`the-light`](https://github.com/butkeraites/the-light)
study engine, consumed as a pinned dependency via [UniFFI](https://mozilla.github.io/uniffi-rs/))
behind an **Expo / React Native** UI, so the same domain logic — reference parsing,
local passage store, search, cross-references, scholarship, and the AI grounding /
citation layer — runs identically on all three targets.

Public-domain Scripture, ~344k voted cross-references, verified Greek/Hebrew, and an
**AI layer that is grounded and cited, never hallucinated** — with **Claude, ChatGPT and
Gemini** as interchangeable engines using **your own API key**.

---

## Non-negotiable principles

These are hard rules, not aspirations. The project halts rather than relaxing them.

- **Offline-first.** Everything essential — reading, multiple PT/EN versions, FTS5
  search, cross-references, notes, highlights, reading plans — works **100% without
  network or an account**. No telemetry.
- **Bring-your-own-key (BYOK).** The AI layer is optional. You supply your own provider
  key (Claude / GPT / Gemini) and pay only for your own usage. **Keys never touch git or
  logs** — they live in the device's secure storage (Keychain on iOS, Keystore on
  Android, an appropriate vault on web).
- **Anti-hallucination (see below).** The model never invents Scripture.
- **License first.** Only public-domain Bible texts are embedded; protected versions are
  never bundled (only via opt-in connectors with the user's own credentials).
- **One source of truth.** Domain logic lives in the Rust core and is shared by web, iOS
  and Android — it is not reimplemented three times.

### Anti-hallucination

Verse text **always** comes from the **local store** (the Rust core reading from the
embedded SQLite database). The LLM **only interprets** — it produces commentary, never the
verse text itself. Fabricated citations are stripped automatically by the core's
`ai::citation` layer, and that citation-stripping runs on **every target** (web, iOS,
Android). Original-language data (Strong's numbers, lemmas, transliterations, glosses)
likewise comes only from the local lexicon database — never from the model.

---

## Features

Everything below works offline; only the AI and optional sync features reach the network,
and only with a key you provide.

- **Reading** — book → chapter → verse navigation, multiple PT/EN versions, parallel
  (side-by-side) versions, light/dark theme.
- **Search** — accent-insensitive full-text (SQLite FTS5) with clickable references.
- **Cross-references** — the OpenBible.info / TSK dataset with its CC-BY attribution shown
  in the UI.
- **Notes & highlights** — created, edited and stored locally in an exportable format.
- **BYOK AI (optional)** — anchored `ask` about a passage, follow-up sessions, and a
  **multi-provider compare** mode running the same locally-built context against
  **Claude, GPT and Gemini** side by side; visible cost estimate.
- **Deep study** — study modes × denominational lenses × depth levels, plus the embedded
  Greek/Hebrew lexicon (Strong's).
- **Academic export** — study output with SBL-style notes exported to Markdown.
- **Reading plans** — plans with progress and local reminders.
- **i18n & themes** — UI in Portuguese and English; light and dark themes.
- **Optional Google-Drive sync** — **opt-in and OFF by default**. While off, no network
  transport is ever enabled; the app is fully functional offline without it.

---

## Embedded content & licensing (attribution manifest)

This table is the **authoritative attribution manifest** for content embedded in the app
(it stands in for a separate `NOTICE` file). The required-attribution strings below are the
verbatim constants shown in-app.

| Content | Source | License | Required attribution |
|---|---|---|---|
| Bible text — KJV (English) | scrollmapper (public-domain KJV) | Public domain | — |
| Bible text — Almeida 1911 (Portuguese) | public-domain Almeida 1911 | Public domain | — |
| Cross-references (~344k, TSK) | OpenBible.info | CC-BY | `Cross references courtesy of OpenBible.info (CC-BY)` |
| Lexicon — Greek/Hebrew, Strong's, glosses | STEP Bible / STEPBible-Data (Tyndale House, Cambridge) | CC BY 4.0 | `Credit it to 'STEP Bible' linked to www.STEPBible.org (data based on work at Tyndale House, Cambridge; CC BY 4.0)` |

Protected translations (e.g. NVI/ARA/ESV) are **never** embedded; they are available only
through opt-in connectors using the user's own credentials.

### Code license

The Light App's own source code is licensed under the **MIT License** — see [`LICENSE`](LICENSE).
MIT covers this repository's code only; the embedded third-party content above keeps its own
terms (public-domain Bible texts, OpenBible.info cross-references CC-BY, STEP/Tyndale lexicon
CC BY 4.0).

---

## Build & run

### Prerequisites

- **Rust** toolchain with the target(s) you build for: `wasm32-unknown-unknown` (web),
  `aarch64-apple-ios` (iOS), `aarch64-linux-android` (Android, via `cargo-ndk`).
- **Node LTS** + npm; **Expo SDK 56** (installed via the app's dependencies).
- **Xcode** for iOS; **Android SDK + NDK** for Android.
- The Rust core (`core/`) consumes **`the-light` pinned at commit
  `225b8c929cf388e29dc148fec3975bf05a884b07`** — never modified from this repo.

### 1. Generate the embedded database

```sh
./scripts/gen-bible-db.sh          # → assets/data/bible.sqlite (KJV + Almeida 1911 + xrefs + lexicon)
```

This runs the canonical `xtask` importers of the pinned `the-light` over public-domain /
CC-BY sources only. It is idempotent.

### 2. Generate the UniFFI bindings for your target

```sh
./scripts/gen-bindings-web.sh      # web / WASM bindings
./scripts/gen-bindings-ios.sh      # iOS (Turbo Module) bindings
./scripts/gen-bindings-android.sh  # Android (Turbo Module) bindings
```

### 3. Run the app

From the `app/` directory:

```sh
cd app
npm install

npx expo start --web   # Web (WASM) — also: npm run web
npx expo run:ios       # iOS simulator — also: npm run ios
npx expo run:android   # Android emulator — also: npm run android
```

### Tests & quality gates

```sh
# Rust core
cd core && cargo fmt && cargo clippy -- -D warnings && cargo test

# TypeScript / app (from app/)
cd app && npx tsc --noEmit
npm run test:web:reading      # + test:web:search, :xref, :notes, :ai, :study, ... (see package.json)

# Headless end-to-end self-tests (native Rust bridge)
./scripts/run-ios-selftest.sh
./scripts/run-android-selftest.sh
```

---

## Architecture at a glance

```
the-light-core (Rust)  ──UniFFI──►  bindings (TS)  ──►  Expo app (Web · iOS · Android)
  reference · store · search · xref · scholarly · ai (local RAG · citation · prompts)
```

The Rust core is compiled to **WASM** for web and to **native Turbo Modules** (Swift on
iOS, Kotlin on Android). See `VISION_AND_ARCHITECTURE.md` for the design rationale,
`IMPLEMENTATION_PLAN.md` for the phased plan, and `DECISIONS.md` for the ADR trail.
