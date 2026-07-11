<div align="center">

# ✦ The Light

**An offline-first, bilingual (PT / EN) Bible-study app for Web, iOS and Android —
with an AI layer that is grounded and cited, _never_ hallucinated.**

One shared **Rust core** behind an **Expo / React Native** UI, so the same domain logic runs
identically on every target. Public-domain Scripture, ~344k voted cross-references, verified
Greek/Hebrew, and **Claude · ChatGPT · Gemini** as interchangeable engines using **your own key**.

[![License: MIT](https://img.shields.io/badge/License-MIT-6e520c.svg)](LICENSE)
&nbsp;![Platforms](https://img.shields.io/badge/platforms-Web%20%7C%20iOS%20%7C%20Android-3b322c)
&nbsp;![Core](https://img.shields.io/badge/core-Rust%20%2B%20UniFFI-b7410e)
&nbsp;![Offline-first](https://img.shields.io/badge/offline--first-100%25-2e7d32)
&nbsp;![AI](https://img.shields.io/badge/AI-bring--your--own--key-8a63d2)

</div>

---

## Contents

- [Why](#why) · [Non-negotiable principles](#non-negotiable-principles) · [Anti-hallucination](#anti-hallucination)
- [Features](#features) · [Try it (free PWA)](#try-it-free-pwa)
- [Embedded content & licensing](#embedded-content--licensing-attribution-manifest)
- [Build & run](#build--run) · [Architecture](#architecture-at-a-glance)

---

## Why

Most Bible apps are online-first and lock study tools behind accounts, ads or subscriptions — and
the ones that add AI happily invent verses. The Light is the opposite bet: **everything essential
works with no network and no account**, the source is open, and the AI is bolted to the local text
so it can _interpret_ but never _fabricate_ Scripture. It ships free as a static PWA and as native
iOS / Android builds from the same Rust core.

---

## Non-negotiable principles

These are hard rules, not aspirations. The project halts rather than relaxing them.

- **Offline-first.** Reading, multiple PT/EN versions, FTS5 search, cross-references, notes,
  highlights, reading plans, the Greek/Hebrew lexicon — all work **100% without network or an
  account**. No telemetry.
- **Bring-your-own-key (BYOK).** The AI layer is optional. You supply your own provider key
  (Claude / GPT / Gemini) and pay only for your own usage. **Keys never touch git or logs** — they
  live in the device's secure storage (Keychain on iOS, Keystore on Android, an appropriate vault on
  web).
- **Anti-hallucination (see below).** The model never invents Scripture.
- **License first.** Only public-domain Bible texts are embedded; protected versions are never
  bundled (only via opt-in connectors with the user's own credentials).
- **One source of truth.** Domain logic — reference parsing, the SQL that reads the store, LLM
  request/response shaping, file formats — lives in the Rust core and is shared by web, iOS and
  Android. It is **not reimplemented three times**; native and web can only _agree_.

### Anti-hallucination

Verse text **always** comes from the **local store** (the Rust core reading from the embedded SQLite
database). The LLM **only interprets** — it produces commentary, never the verse text itself.
Fabricated citations are stripped automatically by the core's `ai::citation` layer, and that
citation-stripping runs on **every target** (web, iOS, Android). Original-language data (Strong's
numbers, lemmas, transliterations, glosses) likewise comes only from the local lexicon database —
never from the model.

---

## Features

Everything below works offline; only the AI and optional sync features reach the network, and only
with a key you provide.

- **Reading** — book → chapter → verse navigation (buttons, keyboard, tap-sides, swipe), multiple
  PT/EN versions, and **parallel** (side-by-side) versions.
- **Reading comfort** — the dark-first **"Vigil"** design (candlelight gold on deep ink) with a
  refined light mode and a **sepia** reading theme; adjustable text size, line height, serif/sans
  family and justification, all persisted locally.
- **Passage lookup** — type a reference and get the text in any version, including **ranges and
  lists** ("John 3:16; Psalm 23", "João 3–4").
- **Smart search** — accent-insensitive full-text (SQLite FTS5) with clickable references, plus
  **autocomplete** (references, recent searches, corpus words) and a **"did you mean?"** rescue that
  only suggests terms which actually return results.
- **Cross-references** — the OpenBible.info / TSK dataset (~344k) with its CC-BY attribution shown in
  the UI.
- **Notes & highlights** — created, edited and stored locally in an exportable format.
- **BYOK AI (optional)** — anchored `ask` about a passage, follow-up sessions, and a
  **multi-provider compare** mode running the same locally-built context against **Claude, GPT and
  Gemini** side by side, with a visible cost estimate and streaming responses.
- **Deep study** — study modes × denominational lenses × depth levels, grounded on the embedded
  Greek/Hebrew **lexicon** (Strong's) and an **interlinear** original-language view.
- **Academic export** — study output with SBL-style notes exported to Markdown.
- **Reading plans, verse of the day, reading streak & share-a-verse** — with local reminders.
- **i18n & themes** — full UI in Portuguese and English; light, dark and sepia.
- **Optional Google-Drive sync** — **opt-in and OFF by default**. While off, no network transport is
  ever enabled; the app is fully functional offline without it.

---

## Try it (free PWA)

The web target is a **static Progressive Web App** — no server, no database service, no runtime
cost. The included [`deploy-web.yml`](.github/workflows/deploy-web.yml) workflow does an
`expo export --platform web` and publishes it to **GitHub Pages for free**:

1. Make the repository public → **Settings → Pages → Source: "GitHub Actions"**.
2. **Actions → "deploy-web" → Run workflow.**

It then lives at `https://<user>.github.io/the-light-app/`. All four translations, cross-references
and the lexicon are bundled (the lexicon is fetched on-demand only when you open study), so reading
is fully offline after first load.

---

## Embedded content & licensing (attribution manifest)

This table is the **authoritative attribution manifest** for content embedded in the app (it stands
in for a separate `NOTICE` file). The required-attribution strings below are the verbatim constants
shown in-app.

| Content | Source | License | Required attribution |
|---|---|---|---|
| Bible text — KJV (English) | scrollmapper (public-domain KJV) | Public domain | — |
| Bible text — Almeida 1911 (Portuguese) | public-domain Almeida 1911 | Public domain | — |
| Bible text — BSB / Bíblia Livre (free versions) | Berean Standard Bible · Bíblia Livre | Public domain / free | — |
| Cross-references (~344k, TSK) | OpenBible.info | CC-BY | `Cross references courtesy of OpenBible.info (CC-BY)` |
| Lexicon — Greek/Hebrew, Strong's, glosses | STEP Bible / STEPBible-Data (Tyndale House, Cambridge) | CC BY 4.0 | `Credit it to 'STEP Bible' linked to www.STEPBible.org (data based on work at Tyndale House, Cambridge; CC BY 4.0)` |

Protected translations (e.g. NVI / ARA / ESV) are **never** embedded; they are available only through
opt-in connectors using the user's own credentials.

### Code license

The Light App's own source code is licensed under the **MIT License** — see [`LICENSE`](LICENSE). MIT
covers this repository's code only; the embedded third-party content above keeps its own terms
(public-domain Bible texts, OpenBible.info cross-references CC-BY, STEP / Tyndale lexicon CC BY 4.0).

---

## Build & run

### Prerequisites

- **Rust** toolchain with the target(s) you build for: `wasm32-unknown-unknown` (web),
  `aarch64-apple-ios` (iOS), `aarch64-linux-android` (Android, via `cargo-ndk`).
- **Node LTS** + npm; **Expo SDK 56** / **React Native 0.85** / **React 19** (installed via the app's
  dependencies).
- **Xcode** for iOS; **Android SDK + NDK** for Android.
- The Rust core (`core/`) consumes **[`the-light`](https://github.com/butkeraites/the-light) pinned at
  commit `80aa1a723b57787ab0548d0bbd8e9cbe4e8a3fb3`** — never modified from this repo (changes to the
  core go through a PR + ADR on that repo).

### 1. Generate the embedded database

```sh
./scripts/gen-bible-db.sh          # → assets/data/bible.sqlite (KJV + Almeida + BSB + Bíblia Livre + xrefs + lexicon)
```

This runs the canonical `xtask` importers of the pinned `the-light` over public-domain / CC-BY
sources only, and is idempotent. The `.sqlite` files under `assets/data/` are **git-ignored build
artifacts**; the web target reads a lighter split (`reading-lite.sqlite` for text + `lexicon-sample.sqlite`
loaded on-demand).

### 2. Generate the UniFFI bindings

```sh
./scripts/gen-bindings-ts.sh       # host + web bindings (what `tsc --noEmit` needs; CI-friendly)
./scripts/gen-bindings-web.sh      # web / WASM bindings
./scripts/gen-bindings-ios.sh      # iOS (Turbo Module) bindings
./scripts/gen-bindings-android.sh  # Android (Turbo Module) bindings
```

### 3. Run the app

```sh
cd app
npm install

npm run web       # Web (WASM)        — a.k.a. npx expo start --web
npm run ios       # iOS simulator     — a.k.a. npx expo run:ios
npm run android   # Android emulator  — a.k.a. npx expo run:android
```

### Tests & quality gates

```sh
# Rust core (frontier crate)
cd core && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test

# TypeScript / app (from app/)
cd app && npm run typecheck                 # tsc --noEmit
node scripts/run-guards.mjs all             # the full headless guard suite (reading, search, xref,
                                            # ai, study, lexicon, interlinear, a11y, i18n, contrast, …)

# Native end-to-end self-tests (Rust bridge)
./scripts/run-ios-selftest.sh
./scripts/run-android-selftest.sh
```

---

## Architecture at a glance

```
the-light-core (Rust)  ──UniFFI──►  bindings (TS)  ──►  Expo app (Web · iOS · Android)
  reference · store · search · xref · scholarly · ai (local RAG · citation · prompts)
        │
        └── DATA-ONLY seam: SQL (as {sql, params}), LLM request/response, and file
            formats are handed to the UI as plain data — the web layer executes them,
            it never re-implements the logic. One source of truth; native and web agree.
```

The Rust core is compiled to **WASM** for web and to **native Turbo Modules** (Swift on iOS, Kotlin on
Android). The web layer is a thin executor: it runs the core's `{sql, params}` plans on `wa-sqlite`
(OPFS), performs the LLM `fetch` with your key, and reads back the same DTOs — no domain logic is
mirrored in TypeScript.

See [`VISION_AND_ARCHITECTURE.md`](VISION_AND_ARCHITECTURE.md) for the design rationale,
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the phased plan, and
[`DECISIONS.md`](DECISIONS.md) for the ADR trail.
