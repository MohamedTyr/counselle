import {
  AtSign,
  ChevronDown,
  MessageSquareText,
  MessagesSquare,
  Search,
} from "lucide-react";
import { useState } from "react";

import type { CounselingMode } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";

type CounselingModeMenuProps = {
  mode: CounselingMode;
  modes: readonly CounselingMode[];
  disabled?: boolean;
  canBrowseSkills?: boolean;
  onModeChange: (mode: CounselingMode) => void;
  onBrowseSkills: () => void;
};

export const COMPOSER_CONTROL_CLASS =
  "h-8 !rounded-[var(--workspace-composer-control-radius)] !border-[var(--workspace-composer-control-border)] !bg-[var(--workspace-composer-control-surface)] px-2.5 text-[13px] font-medium tracking-[-0.01em] !text-[var(--workspace-composer-sources-foreground)] !shadow-none before:!rounded-[calc(var(--workspace-composer-control-radius)-1px)] before:!shadow-none hover:!border-[var(--workspace-composer-control-hover-border)] hover:!bg-[var(--workspace-composer-control-hover-surface)] hover:!text-[var(--workspace-composer-sources-foreground)] data-pressed:!border-[var(--workspace-composer-control-hover-border)] data-pressed:!bg-[var(--workspace-composer-control-hover-surface)] data-popup-open:!border-[var(--workspace-composer-control-hover-border)] data-popup-open:!bg-[var(--workspace-composer-control-hover-surface)] data-popup-open:!text-[var(--workspace-composer-sources-foreground)] sm:h-8";

type ModeIconProps = {
  className?: string;
  mode: CounselingMode;
  trigger?: boolean;
};

function ModeIcon({ className, mode, trigger = false }: ModeIconProps) {
  const iconProps = {
    "aria-hidden": "true",
    className,
    ...(trigger ? { "data-icon": "inline-start" } : {}),
  } as const;

  switch (mode.skillName) {
    case "deep-research":
      return <Search {...iconProps} />;
    case "guided-counselor":
      return <MessagesSquare {...iconProps} />;
    case "focused-answer":
    default:
      return <MessageSquareText {...iconProps} />;
  }
}

export function CounselingModeMenu({
  mode,
  modes,
  disabled = false,
  canBrowseSkills = true,
  onModeChange,
  onBrowseSkills,
}: CounselingModeMenuProps) {
  const [open, setOpen] = useState(false);

  function browseSkills() {
    setOpen(false);
    window.setTimeout(onBrowseSkills, 0);
  }

  return (
    <Menu onOpenChange={setOpen} open={open}>
      <MenuTrigger
        render={
          <Button
            aria-label={`Counseling mode: ${mode.displayName}`}
            className={COMPOSER_CONTROL_CLASS}
            disabled={disabled}
            size="sm"
            type="button"
            variant="outline"
          />
        }
      >
        <ModeIcon mode={mode} trigger />
        <span>{mode.displayName}</span>
        <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="w-72 max-w-[calc(100vw_-_2rem)] px-1 py-1.5"
        side="top"
        sideOffset={8}
      >
        <div className="[zoom:var(--workspace-source-menu-density)]">
          <MenuGroup>
            <MenuRadioGroup
              onValueChange={(value) => {
                const selected = modes.find(
                  (entry) => entry.skillName === value,
                );
                if (selected) {
                  onModeChange(selected);
                }
              }}
              value={mode.skillName}
            >
              <div className="flex flex-col gap-[var(--workspace-source-menu-row-gap)]">
                {modes.map((entry) => (
                  <MenuRadioItem
                    className="group/mode h-7 rounded-lg px-2 py-1 text-[var(--workspace-dropdown-foreground)] transition-[background-color,color] duration-150 data-checked:bg-[var(--workspace-dropdown-hover)] data-highlighted:bg-[var(--workspace-dropdown-hover)] motion-reduce:transition-none"
                    indicator="none"
                    key={entry.skillName}
                    value={entry.skillName}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ModeIcon
                        className="-mx-0.5 size-4.5 shrink-0"
                        mode={entry}
                      />
                      <span className="truncate text-[13px] leading-5 font-medium text-[var(--workspace-composer-sources-foreground)] group-data-checked/mode:text-[var(--workspace-foreground)]">
                        {entry.displayName}
                      </span>
                    </span>
                  </MenuRadioItem>
                ))}
              </div>
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator className="mx-2 my-1 bg-[var(--workspace-dropdown-border)]" />
          <MenuItem
            className="pointer-coarse:min-h-11 rounded-lg px-2 py-1.5 text-[13px] text-[var(--workspace-composer-sources-foreground)] transition-[background-color,color] duration-150 data-highlighted:bg-[var(--workspace-dropdown-hover)] data-highlighted:text-[var(--workspace-composer-sources-foreground)] motion-reduce:transition-none"
            disabled={!canBrowseSkills}
            onClick={browseSkills}
          >
            <AtSign aria-hidden="true" data-icon="inline-start" />
            <span>
              {canBrowseSkills
                ? "More specialized skills..."
                : "Specialized skill limit reached"}
            </span>
          </MenuItem>
        </div>
      </MenuPopup>
    </Menu>
  );
}
