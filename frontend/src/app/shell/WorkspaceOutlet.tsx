import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import { useLocation, useOutlet } from "react-router";

export function WorkspaceOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <LayoutGroup id="counselle-workspace">
        <AnimatePresence initial={false}>
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="absolute inset-0 flex min-h-0 min-w-0"
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.992, y: -12 }
            }
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.992, y: 18 }
            }
            key={location.pathname}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
