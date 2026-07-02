// app/web/selftest.ts — F0.7 (ADR-0008)
//
// Self-test HEADLESS e determinístico da ponte Rust→Expo no NATIVO. Disparado
// SÓ sob `EXPO_PUBLIC_TLA_SELFTEST=1` (não altera a UI normal): resolve duas
// referências (PT e EN) PELO Turbo Module nativo e emite marcadores estáveis no
// console — que no iOS caem no log unificado do simulador (capturado por
// `scripts/run-ios-selftest.sh` via `simctl spawn booted log stream`).
//
// Usa o MESMO `parseReference` do glue da tela (./reference) — sem parser
// paralelo, sem eco: a referência vem do Rust (the-light-core via UniFFI/JSI).
import { parseReference, type Reference } from './reference';
// F1.3: prova de LEITURA no device (marcador TLA_READ). É um par nativo/web por
// extensão — no web, `reading-selftest.web.ts` é um SKIP, mantendo o bundle web
// sem `expo-file-system`/o banco bundled (leitura web = F1.13).
import { runReadingSelfTest } from './reading-selftest';
// F1.6: prova de BUSCA no device (marcador TLA_SEARCH). Par nativo/web por extensão
// — no web, `search-selftest.web.ts` é um SKIP (busca web = F1.14), mantendo o
// bundle web sem `expo-file-system`/o banco bundled.
import { runSearchSelfTest } from './search-selftest';
// F1.9: prova de REFERÊNCIAS CRUZADAS no device (marcador TLA_XREF). Par nativo/web
// por extensão — no web, `xref-selftest.web.ts` é um SKIP (xref web = F1.15),
// mantendo o bundle web sem `expo-file-system`/o banco bundled.
import { runXrefSelfTest } from './xref-selftest';
// F1.11: prova de NOTAS/HIGHLIGHTS + PERSISTÊNCIA no device (marcador TLA_NOTES). Par
// nativo/web por extensão — no web, `notes-selftest.web.ts` é um SKIP (notas web =
// F1.16), mantendo o bundle web sem `expo-file-system`/userdata.
import { runNotesSelfTest } from './notes-selftest';
// F2.5: prova de ESTUDO ASSISTIDO ANCORADO (ask + streaming) no device (marcador
// TLA_ASK, provider="mock", sem chave/rede). Par nativo/web por extensão — no web,
// `ask-selftest.web.ts` é um SKIP (IA web = F2.7), mantendo o bundle web sem a camada
// `ai`/o banco bundled.
import { runAskSelfTest } from './ask-selftest';
// F3.5: prova de ESTUDO PROFUNDO + LÉXICO no device (marcador TLA_STUDY, provider="mock",
// sem chave/rede). Par nativo/web por extensão — no web, `study-selftest.web.ts` é um SKIP
// (estudo/léxico web = F3.12), mantendo o bundle web sem a camada `ai`/store/o banco bundled.
import { runStudySelfTest } from './study-selftest';
// F3.6: prova de CONVERSA/FOLLOW-UP ANCORADO no device (marcador TLA_CHAT, provider="mock",
// sem chave/rede). Par nativo/web por extensão — no web, `chat-selftest.web.ts` é um SKIP
// (conversa web = F3.12), mantendo o bundle web sem a camada `ai`/store/o banco bundled.
import { runChatSelfTest } from './chat-selftest';

// Marcador (prefixo grep-ável). console.error garante o nível alto no log
// unificado; console.log o complementa. O script assere o texto exato.
const MARK = 'TLA_SELFTEST';

function verseField(ref: Reference): string {
  const v = ref.verses;
  if (v.tag === 'Single') {
    return `verse=${v.inner.verse}`;
  }
  if (v.tag === 'Range') {
    return `range=${v.inner.start}-${v.inner.end}`;
  }
  return `tag=${v.tag}`;
}

async function probe(lang: 'PT' | 'EN', input: string): Promise<void> {
  try {
    const ref = await parseReference(input);
    const line = `${MARK} ${lang} book=${ref.book} chapter=${ref.chapter} ${verseField(ref)}`;
    // Dois canais para robustez de captura no log do simulador.
    console.log(line);
    console.error(line);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = `${MARK} ${lang} ERROR ${msg}`;
    console.log(line);
    console.error(line);
  }
}

/**
 * Roda os dois casos canônicos: "Jo 3.16" (PT) e "John 3:16" (EN). Ambos devem
 * resolver para book=43, chapter=3, verse=16 PELO RUST NATIVO.
 */
export async function runReferenceSelfTest(): Promise<void> {
  console.log(`${MARK} START`);
  await probe('PT', 'Jo 3.16');
  await probe('EN', 'John 3:16');
  // F1.3: prova de LEITURA (livro→capítulo→texto) pela fronteira nativa, lendo do
  // banco bundled copiado p/ um caminho gravável. Emite o marcador TLA_READ.
  await runReadingSelfTest();
  // F1.6: prova de BUSCA (campo→fronteira search→hits) no device. Emite TLA_SEARCH.
  await runSearchSelfTest();
  // F1.9: prova de XREF (versículo→fronteira cross_refs→referências) no device.
  // Emite TLA_XREF (composto do retorno real de `cross_refs`).
  await runXrefSelfTest();
  // F1.11: prova de NOTAS/HIGHLIGHTS + PERSISTÊNCIA (put/get/list + 2ª leitura
  // independente do disco) via a fronteira userdata. Emite TLA_NOTES.
  await runNotesSelfTest();
  // F2.5: prova de ESTUDO ASSISTIDO ANCORADO (pergunta→streaming→AiAnswer) via a
  // fronteira `ask_anchored_stream` com o provedor "mock" (offline, sem chave). Emite
  // TLA_ASK (cited_text verbatim do store SEPARADO da interpretação do mock).
  await runAskSelfTest();
  // F3.5: prova de ESTUDO PROFUNDO + LÉXICO (deep_study + lexical_entries) via as
  // fronteiras `deep_study`/`lexical_entries` com o provedor "mock" (offline, sem chave).
  // Emite TLA_STUDY (passageText verbatim do store SEPARADO da interpretação do mock +
  // léxico Strong do banco + atribuição STEP CC-BY).
  await runStudySelfTest();
  // F3.6: prova de CONVERSA/FOLLOW-UP ANCORADO (ask_session_anchored, 2 turnos) via a
  // fronteira `ask_session_anchored` com o provedor "mock" (offline, sem chave). Emite
  // TLA_CHAT (citedText verbatim do store — a âncora — SEPARADO da interpretação do mock;
  // turns = tamanho do histórico enviado no follow-up).
  await runChatSelfTest();
  console.log(`${MARK} DONE`);
}
