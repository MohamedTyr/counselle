// ~ alias resolves to this directory: src/vendor/librechat/app
// Re-export from @librechat/client so vendored components can import from '~/hooks'
export { default as useLocalize } from '@librechat/client/hooks/useLocalize';
export type { TranslationKeys } from '@librechat/client/hooks/useLocalize';
export { default as useNavScrolling } from './Nav/useNavScrolling';

// useElementSize — returns ref + measured width + height of a DOM element
// Used by Conversations.tsx for the virtualized list container.
import { useRef, useState, useCallback, useLayoutEffect } from 'react';

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    if (ref.current) {
      const { offsetWidth, offsetHeight } = ref.current;
      setSize((prev) => {
        if (prev.width === offsetWidth && prev.height === offsetHeight) return prev;
        return { width: offsetWidth, height: offsetHeight };
      });
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    if (!ref.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, width: size.width, height: size.height };
}
