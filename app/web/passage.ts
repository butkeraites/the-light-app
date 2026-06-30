// app/web/passage.ts — F0.10 (ADR-0011)
//
// STUB do `getPassage` no NATIVO (iOS/Android). A leitura de passagem no nativo é
// a F0.9: `the_light_core` (`Store::open` + `EmbeddedSource::passage`) via Turbo
// Module (`get_passage`), e NÃO o caminho web `wa-sqlite`/OPFS. A tela só chama
// `getPassage` no alvo WEB (guard `Platform.OS === 'web'`), então este stub nunca
// é executado em runtime — existe para manter `tsc`/Metro nativo verdes (o Metro
// escolhe este `.ts` no nativo e `passage.web.ts` no web).
//
// O tipo `Passage` (estrutural, espelha o `model` do core) é reusado dos bindings
// para uma assinatura única entre alvos; `import type` é apagado em runtime, então
// o nativo NÃO carrega os bindings web.
import type { Passage } from './generated/the_light_app_core';

export type { Passage };

export async function getPassage(_input: string, _translation?: string): Promise<Passage> {
  throw new Error(
    'getPassage web (wa-sqlite/OPFS) é exclusivo do alvo web (F0.10). No nativo, a ' +
      'leitura de passagem usa o the-light-core (F0.9: get_passage via Turbo Module).',
  );
}
