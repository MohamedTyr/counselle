/**
 * SourcesControl — the Counselle adaptation of the ai-prompt-box toggle pills.
 *
 * In the bar it is ONE pill (styled byte-identical to the upstream toggle pills:
 * rounded-full px-2 py-1 border h-8, motion-rotating icon, slide-out label) whose
 * expand animation is tied to the dropdown being open. The dropdown is a polished
 * source menu:
 *   - Database = always-on anchor with a locked "On" badge (not a dead switch).
 *   - Web / .edu / Reddit = rows with icon + subtitle + a single-accent Switch
 *     (Radix, what shadcn's Switch wraps). One accent, not three, keeps it calm.
 *   - Reddit expands to selectable subreddit chips (echoes the composer's pills).
 * The rotating-icon wow is preserved on each row's icon.
 *
 * `SUBREDDITS`/`Subreddit` come from the app's source store (`@/api/mock/sourceStore`);
 * `SourceId` is the composer-local union the bar speaks in.
 */
import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Globe, Database, GraduationCap, Users, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@librechat/client/utils';
import { SUBREDDITS, type Subreddit } from '@/api/mock/sourceStore';

export type SourceId = 'web' | 'edu' | 'reddit';

export type { Subreddit };

const SOURCE_DEFS: { id: SourceId; label: string; Icon: typeof Globe }[] = [
  { id: 'web', label: 'Web', Icon: Globe },
  { id: 'edu', label: '.edu sites', Icon: GraduationCap },
  { id: 'reddit', label: 'Reddit', Icon: Users },
];

interface SourcesControlProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  active: Set<SourceId>;
  setActive: (next: Set<SourceId>) => void;
  subs: string[];
  setSubs: (next: Subreddit[]) => void;
}

export const SourcesControl: React.FC<SourcesControlProps> = ({ open, setOpen, active, setActive, subs, setSubs }) => {
  const count = active.size + 1; // + Database (always on)
  const isActive = open; // expand/rotate tied to open, not selection

  const toggle = (id: SourceId) => {
    const next = new Set(active);
    next.has(id) ? next.delete(id) : next.add(id);
    setActive(next);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8',
            isActive
              ? 'bg-black/[0.04] border-black/10 text-gray-900 dark:bg-white/[0.08] dark:border-white/15 dark:text-gray-100'
              : 'bg-transparent border-transparent text-gray-500 hover:text-gray-700 dark:text-[#9CA3AF] dark:hover:text-[#D1D5DB]',
          )}
        >
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <motion.div
              animate={{ rotate: isActive ? 360 : 0, scale: isActive ? 1.1 : 1 }}
              whileHover={{ rotate: isActive ? 360 : 15, scale: 1.1, transition: { type: 'spring', stiffness: 300, damping: 10 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              <Globe className="w-4 h-4 text-inherit" />
            </motion.div>
          </div>
          <AnimatePresence>
            {isActive && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="text-xs overflow-hidden whitespace-nowrap text-gray-900 dark:text-gray-100 flex-shrink-0 flex items-center gap-1"
              >
                Sources
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black/10 dark:bg-white/15 px-1 text-[10px] font-semibold">
                  {count}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
          <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={12}
          className={cn(
            'z-50 w-[232px] rounded-2xl border p-1.5',
            'border-gray-200 bg-white text-gray-700 dark:border-white/[0.06] dark:bg-[#171819] dark:text-gray-200',
            'shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-bottom-1',
          )}
        >
          {/* Verified data — the always-on anchor. Stated quietly, not as a control. */}
          <div className="flex items-center gap-2.5 px-2.5 py-0.5" title="Always on. Our verified university data is the foundation of every answer.">
            <Database className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" strokeWidth={1.75} />
            <span className="flex-1 text-[13px] text-gray-700 dark:text-gray-300">Verified data</span>
            <span className="text-[11px] text-gray-400 dark:text-gray-600">Always on</span>
          </div>

          <div className="mx-2.5 my-2 h-px bg-gray-200 dark:bg-white/[0.06]" />

          {SOURCE_DEFS.map(({ id, label, Icon }) => {
            const on = active.has(id);
            return (
              <div key={id}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-0.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                >
                  <SourceIcon Icon={Icon} on={on} />
                  <span className={cn('flex-1 text-[13px] transition-colors', on ? 'text-gray-800 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}>
                    {label}
                  </span>
                  <Toggle on={on} />
                </button>

                <AnimatePresence initial={false}>
                  {id === 'reddit' && on && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-1.5 px-2.5 pb-2 pt-3">
                        {SUBREDDITS.map((s) => {
                          const checked = subs.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() =>
                                setSubs(
                                  checked
                                    ? (subs as Subreddit[]).filter((x) => x !== s)
                                    : [...(subs as Subreddit[]), s],
                                )
                              }
                              className={cn(
                                'rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors',
                                checked
                                  ? 'bg-black/[0.06] text-gray-800 dark:bg-white/[0.09] dark:text-gray-200'
                                  : 'text-gray-400 hover:bg-black/[0.04] dark:text-gray-500 dark:hover:bg-white/[0.04]',
                              )}
                            >
                              {s.replace(/^r\//, '')}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

function SourceIcon({ Icon, on }: { Icon: typeof Globe; on: boolean }) {
  return (
    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
      <motion.span
        animate={{ rotate: on ? 360 : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 25 }}
      >
        <Icon
          className={cn('h-4 w-4', on ? 'text-gray-700 dark:text-[#E6E7E9]' : 'text-gray-400 dark:text-[#6B7280]')}
          strokeWidth={1.75}
        />
      </motion.span>
    </span>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <SwitchPrimitive.Root
      checked={on}
      tabIndex={-1}
      onClick={(e) => e.preventDefault()}
      className="relative h-[15px] w-[26px] flex-shrink-0 rounded-full transition-colors data-[state=unchecked]:bg-gray-200 data-[state=checked]:bg-gray-900 dark:data-[state=unchecked]:bg-white/[0.12] dark:data-[state=checked]:bg-white/85"
    >
      <SwitchPrimitive.Thumb className="block h-[11px] w-[11px] translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[13px] dark:data-[state=checked]:bg-[#171819] dark:data-[state=unchecked]:bg-white/55" />
    </SwitchPrimitive.Root>
  );
}
