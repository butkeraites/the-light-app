// app/lib/useReaderModalA11y.ts — F5.21 (ADR-0049)
//
// a11y de RUNTIME dos painéis MODAIS de leitura (Ask/Chat/Compare/Study/Verse/Xref).
// Ao ABRIR o painel (`visible` false→true), move o foco do leitor de tela para o
// CABEÇALHO do painel — o que dá, de uma vez:
//   • ORDEM DE FOCO lógica: o leitor começa no título (cabeçalho) e desce p/ o
//     conteúdo e as ações (a ordem natural do layout);
//   • ANÚNCIO de ABERTURA: ao pousar o foco no título (com `accessibilityRole="header"`),
//     o VoiceOver/TalkBack LÊ o título — o sinal idiomático de "novo painel/contexto"
//     (iOS HIG / Android). Um `announceForAccessibility` SEPARADO causaria fala DUPLA.
// O FECHAMENTO é anunciado pelo próprio `<Modal>` NATIVO, que devolve o foco ao gatilho
// (o versículo/botão que abriu o painel) — o leitor lê o elemento restaurado.
//
// O `accessibilityViewIsModal` (foco PRESO — o leitor IGNORA o conteúdo atrás do painel)
// é declarado LITERALMENTE na View-folha (`sheet`) de cada painel; a guarda headless
// `reader-modal-a11y` prova estaticamente que essa prop e este hook estão presentes.
//
// OFFLINE; nenhum I/O; nenhuma rede. ANTI-ALUCINAÇÃO: só CROMO de navegação/foco — NÃO
// toca texto bíblico (o versículo/atribuição continua vindo do store, verbatim).
//
// DYNAMIC TYPE: este hook NÃO desativa `allowFontScaling` — a UI de leitura respeita a
// escala de fonte do sistema por padrão (RN escala o texto). A guarda impede regressão
// (nenhum `allowFontScaling={false}` travando o versículo/cromo).
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, type Text } from 'react-native';

/**
 * Retorna uma `ref` a fixar no `<Text>` de TÍTULO do painel modal. Ao abrir
 * (`visible` vira `true`), pousa o foco de acessibilidade no título.
 *
 * @param visible estado de visibilidade do `<Modal>` do painel.
 */
export function useReaderModalA11y(visible: boolean) {
  const headerRef = useRef<Text>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    // WEB: `findNodeHandle` NÃO é suportado no react-native-web (LANÇA "findNodeHandle is not
    // supported on web"). O foco programático do modal é um gesto NATIVO (VoiceOver/TalkBack);
    // no web o RNW já expõe a semântica de dialog via ARIA (o `<Modal>`/`accessibilityViewIsModal`
    // viram role/aria-modal). Então este efeito é NO-OP no web — o `headerRef` segue sendo
    // retornado e fixado no título (sem efeito colateral), e o crash ao abrir o painel some.
    if (Platform.OS === 'web') {
      return;
    }
    // Atraso curto: o <Modal> precisa terminar de montar/animar antes de o foco poder
    // pousar no título (Android costuma precisar de um pouco mais que iOS).
    const delay = Platform.OS === 'android' ? 350 : 150;
    const timer = setTimeout(() => {
      const current = headerRef.current;
      const node = current ? findNodeHandle(current) : null;
      if (node != null) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [visible]);

  return headerRef;
}
