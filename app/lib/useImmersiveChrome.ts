// app/lib/useImmersiveChrome.ts — ADR-0076 (deepening): a barra-overlay imersiva do leitor numa costura
//
// A LEITURA IMERSIVA (ADR-0069-feel) tinha 4 pedaços de estado co-variantes (`barHeight`, `chromeAnim`,
// `chromeGone`, `chromeHidden`) + 2 efeitos interligados (o slide translateY+opacity com curvas
// assimétricas / reduce-motion; e o reset da barra quando uma âncora chega) + ~20 linhas de interpolação
// inline no render — tudo solto na tela do capítulo. Concentrados aqui. É COESÃO (um só caller — o leitor
// imersivo), não deepening smeared-across-callers: a tela renderiza `<Animated.View {...overlayProps}
// style=[..., animatedStyle]>` em vez de open-codar a interpolação. O `scroll→hidden` segue no
// `useHideOnScroll` (a parte já profunda); aqui vive o CICLO da barra (hidden→anim→gone).
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type LayoutChangeEvent } from 'react-native';

import { useHideOnScroll } from './useHideOnScroll';
import { useReducedMotion } from './useReducedMotion';

export function useImmersiveChrome(anchorVerse: number | null) {
  const reduceMotion = useReducedMotion();
  const [barHeight, setBarHeight] = useState(0);
  const { hidden: chromeHidden, onScroll: onReaderScroll, reset: resetChrome } = useHideOnScroll({
    topGuard: barHeight || 24, // dobra como "mínimo antes de esconder": nunca descobre um vão
    hideThreshold: 18, // afiado: responde um pouco antes ao intento de esconder (sem ficar twitchy)
    showThreshold: 6, // afiado: reaparece com um toque a menos de scroll ("acompanha" mais colado)
  });
  const chromeAnim = useRef(new Animated.Value(1)).current; // 1 = visível · 0 = escondido
  // `chromeGone`: barra TOTALMENTE escondida → sai do FLUXO/FOCO/a11y (display:none). Some só ao FIM da
  // animação de esconder e volta ANTES de animar a entrada — controles fora de vista não ficam tabbáveis.
  const [chromeGone, setChromeGone] = useState(false);

  // Desliza a barra (translateY) + fade; curvas ASSIMÉTRICAS: sai acelerando, volta desacelerando.
  useEffect(() => {
    const toValue = chromeHidden ? 0 : 1;
    if (!chromeHidden) setChromeGone(false); // re-monta ANTES de animar a entrada
    if (reduceMotion) {
      chromeAnim.setValue(toValue);
      setChromeGone(chromeHidden);
      return;
    }
    const anim = Animated.timing(chromeAnim, {
      toValue,
      duration: chromeHidden ? 150 : 190, // afiado: saída/volta mais curtas = mais snappy
      easing: chromeHidden ? Easing.bezier(0.3, 0, 1, 1) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && chromeHidden) setChromeGone(true); // fora do foco/a11y após terminar de esconder
    });
    return () => anim.stop(); // interrupção limpa em viradas rápidas de direção
  }, [chromeHidden, reduceMotion, chromeAnim]);

  // Âncora de busca/xref: a barra deve estar VISÍVEL quando a nova âncora chega (senão a rolagem
  // programática a esconde e o versículo-alvo fica atrás dela).
  useEffect(() => {
    if (anchorVerse != null) {
      resetChrome();
    }
  }, [anchorVerse, resetChrome]);

  return {
    /** Altura medida da barra — `topInset` do texto + `translateY` da barra. */
    barHeight,
    /** Handler de scroll do corpo de leitura (dirige esconder/mostrar). */
    onReaderScroll,
    /** Reexibe a barra imediatamente (virar capítulo / âncora nova). */
    resetChrome,
    /** Props do `<Animated.View>` da barra: medição + a11y/toque quando escondida. */
    overlayProps: {
      pointerEvents: (chromeHidden ? 'none' : 'auto') as 'none' | 'auto',
      accessibilityElementsHidden: chromeHidden,
      importantForAccessibility: (chromeHidden ? 'no-hide-descendants' : 'auto') as
        | 'no-hide-descendants'
        | 'auto',
      onLayout: (e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0 && h !== barHeight) setBarHeight(h);
      },
    },
    /** `true` quando a barra está TOTALMENTE fora de vista (aplicar `display:none`). */
    gone: chromeGone,
    /** Estilo ANIMADO (translateY + opacity, driver nativo) do `<Animated.View>`. */
    animatedStyle: {
      transform: [
        { translateY: chromeAnim.interpolate({ inputRange: [0, 1], outputRange: [-barHeight, 0] }) },
      ],
      opacity: chromeAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.15, 1] }),
    },
  };
}
