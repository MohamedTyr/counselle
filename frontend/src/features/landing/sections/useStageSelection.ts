import { useCallback, useState } from "react";
import { FEATURES } from "./featureList";

type Shown = { active: number; run: number };
type Selection = Shown & {
  /** The selection came from the keyboard, so it arrives without motion. */
  keyboard: boolean;
  /** The sheet on its way out, until it reports it has gone. */
  leaving: Shown | null;
};

/** Which feature is on stage, and the sheet leaving it; every selection is a new run. */
export function useStageSelection() {
  const [selection, setSelection] = useState<Selection>({
    active: 0,
    run: 0,
    keyboard: false,
    leaving: null,
  });

  /** Choosing the open feature plays it again. */
  const select = useCallback(
    (next: number | ((active: number) => number), byKeyboard: boolean) =>
      setSelection((shown) => ({
        active: typeof next === "function" ? next(shown.active) : next,
        run: shown.run + 1,
        keyboard: byKeyboard,
        leaving: byKeyboard ? null : { active: shown.active, run: shown.run },
      })),
    [],
  );
  const advance = useCallback(
    () => select((shown) => (shown + 1) % FEATURES.length, false),
    [select],
  );
  const onGone = useCallback(
    (gone: number) =>
      setSelection((shown) =>
        shown.leaving?.run === gone ? { ...shown, leaving: null } : shown,
      ),
    [],
  );
  return { ...selection, select, advance, onGone };
}
