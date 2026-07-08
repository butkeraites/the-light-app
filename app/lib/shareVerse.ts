// app/lib/shareVerse.ts — Rodada 4: compartilhar versículo (NATIVO). Ver `shareVerse.web.ts` p/ web.
//
// Usa o Share nativo do react-native (folha de compartilhamento do SO). O texto é montado por
// `buildShareMessage` (puro, compartilhado com o web). Offline: nenhum dado sai sem o usuário
// escolher para onde compartilhar; nada é logado.
import { Share } from 'react-native';

import { buildShareMessage, type ShareVerseResult } from './shareVerseMessage';

export { buildShareMessage, type ShareVerseResult };

export async function shareVerse(text: string, reference: string, translationLabel: string): Promise<ShareVerseResult> {
  await Share.share({ message: buildShareMessage(text, reference, translationLabel) });
  return 'shared';
}
