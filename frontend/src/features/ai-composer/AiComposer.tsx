import { Globe2, GraduationCap, MessageCircle, Send, Square } from "lucide-react"
import { useEffect, type FormEvent, type KeyboardEvent } from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { cn } from "@/lib/utils"
import type { SourceConfig } from "@/api/chat/types"

type AiComposerProps = {
  value: string
  onValueChange: (value: string) => void
  sourceConfig: SourceConfig
  onSourceConfigChange: (sourceConfig: SourceConfig) => void
  onSubmit: () => void
  onCancel: () => void
  isSubmitting: boolean
  canCancel: boolean
  disabled?: boolean
}

type SourceToggle = {
  key: "webSearch" | "eduSources" | "reddit"
  label: string
  shortLabel: string
  icon: typeof Globe2
}

const sourceToggles: SourceToggle[] = [
  {
    key: "webSearch",
    label: "Web search",
    shortLabel: "Web",
    icon: Globe2,
  },
  {
    key: "eduSources",
    label: ".edu sources",
    shortLabel: ".edu",
    icon: GraduationCap,
  },
  {
    key: "reddit",
    label: "Reddit communities",
    shortLabel: "Reddit",
    icon: MessageCircle,
  },
]

export function AiComposer({
  value,
  onValueChange,
  sourceConfig,
  onSourceConfigChange,
  onSubmit,
  onCancel,
  isSubmitting,
  canCancel,
  disabled = false,
}: AiComposerProps) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 34,
    maxHeight: 220,
  })
  const canSubmit = value.trim().length > 0 && !isSubmitting && !disabled
  const hasValue = value.trim().length > 0

  useEffect(() => {
    adjustHeight(value.length === 0)
  }, [adjustHeight, value])

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSubmit) {
      return
    }
    onSubmit()
    adjustHeight(true)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  function patchSource(key: SourceToggle["key"]) {
    onSourceConfigChange({
      ...sourceConfig,
      [key]: !sourceConfig[key],
    })
  }

  return (
    <form
      aria-label="Start an AI conversation"
      className="w-full"
      onSubmit={handleSubmit}
    >
      <div
        className={cn(
          "group flex min-h-28 w-full flex-col overflow-hidden rounded-2xl transition-colors",
          "bg-[#1e1d1c] text-card-foreground",
          hasValue
            ? "border border-[#434240] focus-within:border-[#434240]"
            : "border border-[#383736] focus-within:border-[#434240]",
        )}
      >
        <Textarea
          aria-label="Message Counselle"
          unstyled
          className={cn(
            "min-h-10 max-h-18 w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-base leading-5 shadow-none outline-none",
            "placeholder:text-[var(--workspace-foreground-soft)] focus-visible:ring-0 md:px-4 md:pt-2.5",
          )}
          disabled={disabled}
          onChange={(event) => {
            onValueChange(event.target.value)
            adjustHeight()
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message Counselle"
          ref={textareaRef}
          style={{ resize: "none" }}
          value={value}
        />

        <div className="mt-auto flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-[var(--workspace-border-soft)] px-3 py-2.5 md:px-4">
          <div className="flex flex-wrap items-center gap-2">
            {sourceToggles.map((toggle) => {
              const Icon = toggle.icon
              const pressed = sourceConfig[toggle.key]

              return (
                <Button
                  aria-label={toggle.label}
                  aria-pressed={pressed}
                  className={cn(
                    "h-8 rounded-lg px-2.5 text-xs font-medium",
                    pressed
                      ? "border-[var(--workspace-upcoming-task-card-hover-border)] bg-[var(--workspace-surface-active)] text-foreground"
                      : "text-muted-foreground",
                  )}
                  disabled={disabled || isSubmitting}
                  key={toggle.key}
                  onClick={() => patchSource(toggle.key)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icon data-icon="inline-start" />
                  <span aria-hidden="true" className="hidden sm:inline">
                    {toggle.label}
                  </span>
                  <span aria-hidden="true" className="sm:hidden">
                    {toggle.shortLabel}
                  </span>
                </Button>
              )
            })}
          </div>

          {canCancel ? (
            <Button
              aria-label="Stop response"
              className="size-9 shrink-0 rounded-lg"
              onClick={onCancel}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Square data-icon="inline-start" />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              className="size-9 shrink-0 rounded-lg"
              disabled={!canSubmit}
              size="icon"
              type="submit"
            >
              <Send data-icon="inline-start" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
