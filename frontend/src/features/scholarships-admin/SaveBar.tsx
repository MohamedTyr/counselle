import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * The editor's explicit save — a deliberate exception to autosave-on-blur
 * (DESIGN.md §17.3): a half-typed edit must never reach a published record a
 * student is reading. In conflict (another admin saved first) Save gives way
 * to "Load their version"; the draft stays on screen until then.
 */
export function SaveBar({
  isSaving,
  blockedReason,
  conflict,
  onSave,
  onDiscard,
}: {
  isSaving: boolean;
  blockedReason: string | null;
  conflict?: { onReload: () => void };
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-[var(--z-sticky)] flex justify-center px-4">
      <div
        className="scholarship-savebar-enter pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-full border border-[var(--edge-strong)] bg-[var(--surface-raised)] py-1.5 ps-5 pe-1.5 shadow-[var(--elevation-2)]"
        role="region"
        aria-label="Unsaved changes"
      >
        <span
          aria-hidden="true"
          className={
            conflict
              ? "size-1.5 shrink-0 rounded-full bg-[var(--danger-solid)]"
              : "size-1.5 shrink-0 rounded-full bg-[var(--warning-solid)]"
          }
        />
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-sm text-[var(--ink-secondary)]" role="status">
          {conflict ? "Someone else changed this scholarship" : (blockedReason ?? "Unsaved changes")}
        </span>
        <Button disabled={isSaving} onClick={onDiscard} size="sm" variant="ghost">
          Discard
        </Button>
        {conflict ? (
          <Button onClick={conflict.onReload} size="sm">
            Load their version
          </Button>
        ) : (
          <Button disabled={blockedReason !== null} loading={isSaving} onClick={onSave} size="sm">
            Save
            <Kbd className="hidden bg-white/15 text-[var(--on-brand)] sm:inline-flex">{IS_MAC ? "⌘S" : "Ctrl S"}</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
