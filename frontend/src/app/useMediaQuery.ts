/**
 * Reactive media-query hooks. `useIsDesktop` drives whether the artifact
 * opens as a docked resizable pane (desktop) or a full-screen sheet (mobile).
 * Matches the 768px breakpoint the sidebar already keys off (state.ts).
 */
import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
