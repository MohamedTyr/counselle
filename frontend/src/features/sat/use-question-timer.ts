import { useCallback, useEffect, useRef, useState } from "react";

/** The per-question count-up timer (plan §5.5; parity Q5, Q5a, Q6, Q25a).
 *
 * Upstream ticks a `setInterval` counter every second and records whatever
 * it reached (Q25a) — browsers throttle `setInterval` in a background tab,
 * so a student who tabs away under-reports the time they actually spent.
 * This hook instead accumulates elapsed time from wall-clock timestamps
 * while running; the 1s interval below exists only to re-render the
 * displayed `MM:SS`, never to source the recorded value. `readElapsed()`
 * reads the same timestamp arithmetic through a ref, so a caller (submit)
 * always gets the true elapsed seconds even if the last display tick was
 * throttled or skipped entirely.
 */
export interface QuestionTimerApi {
  /** Seconds elapsed in the current question, for display — re-renders on
   * every visible tick while running. */
  seconds: number;
  isRunning: boolean;
  pause: () => void;
  resume: () => void;
  toggleRunning: () => void;
  /** True elapsed seconds, computed from timestamps, not from `seconds`
   * (Q25a) — call this at submit time instead of reading the display
   * value, which may be a tick stale. */
  readElapsed: () => number;
}

const TICK_MS = 1_000;

/** `questionKey` identifies the current question: on every change the
 * timer resets to 0 and is forced running (Q5a) — including when
 * revisiting an already-submitted question, whose clock restarts from 0
 * (Q6). `isRunning`/hidden-display state is the caller's own concern and is
 * never touched by a key change. */
export function useQuestionTimer(questionKey: string | number): QuestionTimerApi {
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(true);

  const accumulatedMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);

  const elapsedMs = useCallback((): number => {
    const since = runningSinceRef.current;
    if (since === null) {
      return accumulatedMsRef.current;
    }
    return accumulatedMsRef.current + (Date.now() - since);
  }, []);

  const readElapsed = useCallback((): number => Math.floor(elapsedMs() / 1000), [elapsedMs]);

  useEffect(() => {
    accumulatedMsRef.current = 0;
    runningSinceRef.current = Date.now();
    // questionKey is the sole reset trigger (Q5a): every index change sets
    // the clock to 0 and forces it running, ignoring any prior paused
    // state on purpose — including a revisit of an already-timed question
    // (Q6). isRunning/seconds are deliberately not in the deps list below;
    // this effect must run only on a key change, never on a pause/resume.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: this effect IS the Q5a reset, not state synced from an external system.
    setIsRunning(true);
    setSeconds(0);
  }, [questionKey]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const interval = setInterval(() => {
      setSeconds(readElapsed());
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [isRunning, readElapsed]);

  const pause = useCallback(() => {
    setIsRunning((running) => {
      if (!running) {
        return running;
      }
      accumulatedMsRef.current = elapsedMs();
      runningSinceRef.current = null;
      return false;
    });
  }, [elapsedMs]);

  const resume = useCallback(() => {
    setIsRunning((running) => {
      if (running) {
        return running;
      }
      runningSinceRef.current = Date.now();
      return true;
    });
  }, []);

  const toggleRunning = useCallback(() => {
    if (isRunning) {
      pause();
    } else {
      resume();
    }
  }, [isRunning, pause, resume]);

  return { seconds, isRunning, pause, resume, toggleRunning, readElapsed };
}
