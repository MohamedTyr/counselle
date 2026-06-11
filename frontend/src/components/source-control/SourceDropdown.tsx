/**
 * Counselle-native source-control dropdown.
 *
 * Lives in src/components/source-control/ (OUR namespace, not vendor/).
 * Built from vendored primitives (@librechat/client Switch, Radix Popover).
 * Icon button uses the EXACT same classes as StopButton/SendButton siblings.
 * No new styling — all classes are copies from vendored ChatForm bottom row.
 */
import { useState, useEffect, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal } from 'lucide-react';
import { Switch } from '@librechat/client';
import { cn } from '@librechat/client/utils';
import {
  SUBREDDITS,
  getSourceConfig,
  updateSourceConfig,
  type SourceConfig,
  type Subreddit,
} from '@/api/mock/sourceStore';

interface SourceDropdownProps {
  conversationId: string | null;
}

export default function SourceDropdown({ conversationId }: SourceDropdownProps) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<SourceConfig>(() => getSourceConfig(conversationId));

  // Re-load config when the conversation changes
  useEffect(() => {
    setConfig(getSourceConfig(conversationId));
  }, [conversationId]);

  const patch = useCallback(
    (partial: Partial<SourceConfig>) => {
      const next = updateSourceConfig(conversationId, partial);
      setConfig(next);
    },
    [conversationId],
  );

  const toggleSubreddit = useCallback(
    (sub: Subreddit, checked: boolean) => {
      const current = config.selectedSubreddits;
      const next = checked
        ? ([...current, sub] as Subreddit[])
        : current.filter((s) => s !== sub);
      patch({ selectedSubreddits: next });
    },
    [config.selectedSubreddits, patch],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {/* Icon button: same classes as upstream's left-slot AttachFileMenu trigger */}
        <button
          type="button"
          aria-label="Source settings"
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            open && 'bg-surface-hover',
          )}
        >
          <SlidersHorizontal className="icon-md text-text-primary" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            // NOTE: not .popover-ui — that class is Ariakit-only (hidden until [data-enter]),
            // and this is a Radix popover animated via data-[state] below.
            'z-40 flex w-72 flex-col rounded-xl border border-border-light bg-surface-chat p-3 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {/* ── Fixed row: Database (always on) ─────────────────────────── */}
          <div className="flex items-center justify-between rounded-lg px-2 py-2 opacity-60">
            <span className="text-sm font-medium text-text-primary">Database</span>
            <Switch
              aria-label="Database always on"
              checked={true}
              disabled={true}
              className="cursor-not-allowed"
            />
          </div>
          <div className="my-1.5 h-px bg-border-light" />

          {/* ── Web search ────────────────────────────────────────────────── */}
          <ToggleRow
            label="Web search"
            checked={config.webSearch}
            onCheckedChange={(v) => patch({ webSearch: v })}
          />

          {/* ── .edu sources ─────────────────────────────────────────────── */}
          <ToggleRow
            label=".edu sources"
            checked={config.eduSources}
            onCheckedChange={(v) => patch({ eduSources: v })}
          />

          {/* ── Reddit ───────────────────────────────────────────────────── */}
          <ToggleRow
            label="Reddit"
            checked={config.reddit}
            onCheckedChange={(v) => patch({ reddit: v })}
          />

          {/* ── Reddit subreddit checkboxes (shown when reddit is on) ────── */}
          {config.reddit && (
            <div className="mt-1 ml-4 space-y-1 border-l border-border-light pl-3">
              {SUBREDDITS.map((sub) => (
                <label
                  key={sub}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-text-secondary hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    className="accent-primary h-3.5 w-3.5 rounded"
                    checked={config.selectedSubreddits.includes(sub)}
                    onChange={(e) => toggleSubreddit(sub, e.target.checked)}
                  />
                  {sub}
                </label>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-surface-hover">
      <span className="text-sm text-text-primary">{label}</span>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
