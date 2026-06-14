/**
 * EtherealShadow — an ambient, displacement-mapped shadow used as a background
 * atmosphere layer. Adapted from a Framer community component with three changes
 * for Counselle:
 *   1. Self-hosted mask/noise assets (no external framerusercontent.com hotlink).
 *   2. Brand-tinted via the `color` prop (defaults to the teal `--ethereal-shadow`
 *      token) instead of the demo's neutral gray; the demo heading is removed so
 *      it composes purely as a background.
 *   3. prefers-reduced-motion disables the hue-rotate / displacement animation.
 *
 * The animation drives an SVG turbulence + double displacement filter; it is
 * compositor-isolated to this layer and unmounts with the landing page.
 */
import { useRef, useId, useEffect, type CSSProperties } from 'react';
import { animate, useMotionValue, useReducedMotion, AnimationPlaybackControls } from 'framer-motion';

const MASK_SRC = '/backgrounds/ethereal-mask.webp';

interface AnimationConfig {
  /** Displacement strength, 1–100. Larger = more billowing. */
  scale: number;
  /** Cycle speed, 1–100. Larger = faster. */
  speed: number;
}

interface EtherealShadowProps {
  color?: string;
  animation?: AnimationConfig;
  style?: CSSProperties;
  className?: string;
}

function mapRange(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number {
  if (fromLow === fromHigh) {
    return toLow;
  }
  const percentage = (value - fromLow) / (fromHigh - fromLow);
  return toLow + percentage * (toHigh - toLow);
}

const useInstanceId = (): string => {
  const id = useId();
  const cleanId = id.replace(/:/g, '');
  return `ethereal-${cleanId}`;
};

export function EtherealShadow({
  color = 'var(--ethereal-shadow)',
  animation,
  style,
  className,
}: EtherealShadowProps) {
  const id = useInstanceId();
  const prefersReducedMotion = useReducedMotion();
  const animationEnabled = !!animation && animation.scale > 0 && !prefersReducedMotion;
  const feColorMatrixRef = useRef<SVGFEColorMatrixElement>(null);
  const hueRotateMotionValue = useMotionValue(180);
  const hueRotateAnimation = useRef<AnimationPlaybackControls | null>(null);

  const displacementScale = animation ? mapRange(animation.scale, 1, 100, 20, 100) : 0;
  const animationDuration = animation ? mapRange(animation.speed, 1, 100, 1000, 50) : 1;

  useEffect(() => {
    // Always return the cleanup unconditionally so the loop is stopped when
    // animationEnabled flips false (e.g. reduced-motion enabled mid-session).
    if (!animationEnabled) {
      return;
    }

    const start = () => {
      hueRotateMotionValue.set(0);
      // Throttle the main-thread setAttribute to every 4th rAF tick (~15fps).
      // The hue cycle is ~14s, so a coarser update step is visually
      // indistinguishable while cutting per-frame main-thread cost ~75%.
      const FRAME_STRIDE = 4;
      let frame = 0;
      hueRotateAnimation.current = animate(hueRotateMotionValue, 360, {
        duration: animationDuration / 25,
        repeat: Infinity,
        repeatType: 'loop',
        repeatDelay: 0,
        ease: 'linear',
        delay: 0,
        onUpdate: (value: number) => {
          if (frame++ % FRAME_STRIDE !== 0) {
            return;
          }
          if (feColorMatrixRef.current) {
            feColorMatrixRef.current.setAttribute('values', String(value));
          }
        },
      });
    };

    // Pause the per-frame loop while the tab is hidden so it doesn't burn CPU
    // (and battery) on a background tab; resume on return.
    const onVisibility = () => {
      if (document.hidden) {
        hueRotateAnimation.current?.stop();
      } else if (!hueRotateAnimation.current || hueRotateAnimation.current.state === 'finished') {
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      hueRotateAnimation.current?.stop();
    };
  }, [animationEnabled, animationDuration, hueRotateMotionValue]);

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        height: '100%',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: -displacementScale,
          filter: animationEnabled ? `url(#${id}) blur(4px)` : 'none',
          // Promote to its own compositor layer so the per-frame filter repaint
          // stays off the main layout path.
          willChange: animationEnabled ? 'filter' : undefined,
          transform: 'translateZ(0)',
        }}
      >
        {animationEnabled && animation && (
          <svg width={0} height={0} style={{ position: 'absolute', overflow: 'visible' }}>
            <defs>
              <filter id={id}>
                <feTurbulence
                  result="undulation"
                  numOctaves="2"
                  baseFrequency={`${mapRange(animation.scale, 0, 100, 0.001, 0.0005)},${mapRange(
                    animation.scale,
                    0,
                    100,
                    0.004,
                    0.002,
                  )}`}
                  seed="0"
                  type="turbulence"
                />
                <feColorMatrix
                  ref={feColorMatrixRef}
                  in="undulation"
                  result="hueRotated"
                  type="hueRotate"
                  values="180"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="hueRotated"
                  scale={displacementScale}
                  result="dist"
                />
                <feColorMatrix
                  in="dist"
                  result="circulation"
                  type="matrix"
                  values="4 0 0 0 1  4 0 0 0 1  4 0 0 0 1  1 0 0 0 0"
                />
                <feDisplacementMap
                  in="circulation"
                  in2="undulation"
                  scale={displacementScale}
                  result="output"
                />
              </filter>
            </defs>
          </svg>
        )}
        <div
          style={{
            // A gradient (not a flat fill) so the displacement filter has
            // internal structure to warp — that is what reads as drifting
            // motion. It also pools the color toward the lower half, matching
            // the landing's glow intent. No solid backgroundColor — the
            // transparent stops are what the displacement map can move. The
            // bloom is centered where the composer sits (see ChatView), so the
            // input reads as the light source.
            backgroundImage: `radial-gradient(72% 58% at 50% 42%, ${color} 0%, color-mix(in oklab, ${color} 65%, transparent) 42%, transparent 75%)`,
            maskImage: `url('${MASK_SRC}')`,
            WebkitMaskImage: `url('${MASK_SRC}')`,
            maskSize: 'cover',
            WebkitMaskSize: 'cover',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
            width: '100%',
            height: '100%',
          }}
        />
      </div>
    </div>
  );
}

export default EtherealShadow;
