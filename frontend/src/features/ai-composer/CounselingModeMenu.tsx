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
  MenuGroupLabel,
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
        className="w-[22rem] max-w-[calc(100vw_-_2rem)] px-1 py-1.5"
        side="top"
        sideOffset={8}
      >
        <MenuGroup>
          <MenuGroupLabel className="px-2 pt-1 pb-2 text-[11px] tracking-[0.08em] uppercase">
            How should Counselle help?
          </MenuGroupLabel>
          <MenuRadioGroup
            onValueChange={(value) => {
              const selected = modes.find((entry) => entry.skillName === value);
              if (selected) {
                onModeChange(selected);
              }
            }}
            value={mode.skillName}
          >
            <div className="flex flex-col gap-1">
              {modes.map((entry) => (
                <MenuRadioItem
                  className="pointer-coarse:min-h-11 grid-cols-[.75rem_1fr] rounded-lg py-2"
                  key={entry.skillName}
                  value={entry.skillName}
                >
                  <span className="flex items-start gap-2">
                    <ModeIcon
                      className="mt-0.5 size-4 shrink-0"
                      mode={entry}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[13px] leading-4 font-medium">
                        {entry.displayName}
                      </span>
                      <span className="text-xs leading-4 text-muted-foreground">
                        {entry.description}
                      </span>
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </div>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          className="pointer-coarse:min-h-11 rounded-lg"
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
      </MenuPopup>
    </Menu>
  );
}
