/**
 * AnimatedGreeting — the landing headline, revealed word by word.
 *
 * Replaces the per-letter `SplitText` spring on the landing greeting with a
 * calmer word-level blur + rise reveal. Pattern adapted from 21st.dev's
 * `TextReveal` (revealY + blur), reimplemented on framer-motion (already a
 * dependency) instead of GSAP so we don't pull a second animation engine.
 *
 * Reduced-motion safe: renders fully visible with no animation. Reports its
 * rendered line count so the vendored `Landing` keeps its dynamic spacing.
 */
import { Fragment, useCallback, useEffect, useRef } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { cn } from '~/utils';

interface AnimatedGreetingProps {
  text: string;
  className?: string;
  /** Reported whenever the rendered line count changes (parity with SplitText). */
  onLineCountChange?: (count: number) => void;
}

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const word: Variants = {
  hidden: { opacity: 0, y: '0.5em', filter: 'blur(10px)', willChange: 'transform, opacity, filter' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    // Drop the compositor-layer hint once the word lands so the spans don't
    // stay promoted for the lifetime of the landing page.
    willChange: 'auto',
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function AnimatedGreeting({
  text,
  className,
  onLineCountChange,
}: AnimatedGreetingProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLHeadingElement>(null);
  const words = text.split(' ');

  const measureLines = useCallback(() => {
    const el = ref.current;
    if (!el || !onLineCountChange) {
      return;
    }
    const tops = new Set<number>();
    el.querySelectorAll<HTMLElement>('[data-word]').forEach((w) => tops.add(w.offsetTop));
    onLineCountChange(Math.max(1, tops.size));
  }, [onLineCountChange]);

  useEffect(() => {
    measureLines();
    const ro = new ResizeObserver(measureLines);
    if (ref.current) {
      ro.observe(ref.current);
    }
    return () => ro.disconnect();
  }, [measureLines, text]);

  return (
    <motion.h1
      ref={ref}
      key={text}
      className={cn('text-balance', className)}
      variants={container}
      initial={reduce ? false : 'hidden'}
      animate="visible"
    >
      {words.map((w, i) => (
        <Fragment key={`${w}-${i}`}>
          <motion.span data-word variants={word} className="inline-block">
            {w}
          </motion.span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </motion.h1>
  );
}
