/**
 * ResponseModeControl — a mode pill that lets the user arm "Deep research"
 * for their next send. Modelled after SourcesControl: rounded-full pill, motion
 * icon, slide-out label, Radix Popover with the same styling tokens.
 *
 * The armed state lives in `deepResearchArmedAtom`; ChatContext resets it after
 * each send so a double-send can't accidentally fire deep research twice.
 */
import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { FileSearch, MessageSquare, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAtom } from 'jotai';
import { cn } from '@librechat/client/utils';
import { deepResearchArmedAtom } from '@/app/state';

interface ResponseModeControlProps {
  disabled?: boolean;
}

export const ResponseModeControl: React.FC<ResponseModeControlProps> = ({ disabled }) => {
  const [armed, setArmed] = useAtom(deepResearchArmedAtom);
  const [open, setOpen] = React.useState(false);
  const TriggerIcon = armed ? FileSearch : MessageSquare;

  const selectMode = (mode: 'standard' | 'research') => {
    setArmed(mode === 'research');
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={armed ? 'Response mode: Deep research' : 'Response mode: Standard'}
          title={armed ? 'Deep research mode' : 'Response mode'}
          className={cn(
            'rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8',
            armed
              ? 'bg-teal-500/15 border-teal-500 text-teal-600 dark:text-teal-400'
              : open
              ? 'bg-black/[0.04] border-black/10 text-gray-900 dark:bg-white/[0.08] dark:border-white/15 dark:text-gray-100'
              : 'bg-transparent border-transparent text-gray-500 hover:text-gray-700 dark:text-[#9CA3AF] dark:hover:text-[#D1D5DB]',
          )}
        >
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <motion.div
              animate={{ scale: (open || armed) ? 1.08 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              <TriggerIcon className="w-4 h-4 text-inherit" />
            </motion.div>
          </div>
          <AnimatePresence>
            {armed && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="text-xs overflow-hidden whitespace-nowrap flex-shrink-0"
              >
                Research
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={12}
          className={cn(
            'z-50 w-[260px] rounded-2xl border p-1.5',
            'border-gray-200 bg-white dark:border-white/[0.06] dark:bg-[#171819]',
            'shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-bottom-1',
          )}
        >
          <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
            Response mode
          </div>

          <button
            type="button"
            onClick={() => selectMode('standard')}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
          >
            <MessageSquare className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-gray-800 dark:text-gray-200">Standard</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500">Fast answers for everyday questions</div>
            </div>
            {!armed && <Check className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
          </button>

          <button
            type="button"
            onClick={() => selectMode('research')}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
          >
            <FileSearch className="h-4 w-4 flex-shrink-0 text-teal-500" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-gray-800 dark:text-gray-200">Deep research</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500">Planned, multi-source report with verification</div>
            </div>
            {armed && <Check className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />}
          </button>

          <div className="px-2.5 py-1.5 text-[11px] text-gray-400 dark:text-gray-600">
            Deep research applies to your next message.
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
