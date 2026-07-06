"use client";

import { cn } from "@/lib/utils";
import type { MotionProps } from "motion/react";
import { motion } from "motion/react";
import type { ComponentType, CSSProperties, JSX } from "react";
import { memo, useMemo } from "react";

type MotionHTMLProps = MotionProps & Record<string, unknown>;

const motionComponents = {
  div: motion.div as ComponentType<MotionHTMLProps>,
  em: motion.em as ComponentType<MotionHTMLProps>,
  h1: motion.h1 as ComponentType<MotionHTMLProps>,
  h2: motion.h2 as ComponentType<MotionHTMLProps>,
  h3: motion.h3 as ComponentType<MotionHTMLProps>,
  h4: motion.h4 as ComponentType<MotionHTMLProps>,
  h5: motion.h5 as ComponentType<MotionHTMLProps>,
  h6: motion.h6 as ComponentType<MotionHTMLProps>,
  p: motion.p as ComponentType<MotionHTMLProps>,
  span: motion.span as ComponentType<MotionHTMLProps>,
  strong: motion.strong as ComponentType<MotionHTMLProps>,
} as const satisfies Partial<
  Record<keyof JSX.IntrinsicElements, ComponentType<MotionHTMLProps>>
>;

type TextShimmerElement = keyof typeof motionComponents;

export interface TextShimmerProps {
  children: string;
  as?: TextShimmerElement;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent = motionComponents[Component] ?? motion.p;

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
