// app/lib/aiConfigure.ts — ADR-0079 (deepening): navegar p/ Ajustes de provedor (BYOK)
//
// O handler `onConfigureProvider` — `onClose(); router.push('/settings')` — era copiado BYTE-A-BYTE nos
// 5 painéis de IA (Ask/Chat/Study/Compare/Scope). Concentrado aqui: fecha o painel e vai à tela de chaves
// BYOK. Sem estado/rede — só navegação. (O SEAM de provedor/BYOK já é a ADR-0059; isto é o handler.)
import { router } from 'expo-router';

/** Fecha o painel e navega para os Ajustes (configurar a chave BYOK do provedor). */
export function goToProviderSettings(onClose: () => void): void {
  onClose();
  router.push('/settings');
}
