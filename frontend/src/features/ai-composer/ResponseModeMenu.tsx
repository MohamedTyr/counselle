import { BrainCircuit, ChevronDown, Zap } from "lucide-react";

import { isResponseMode } from "@/api/chat/response-mode";
import type { ResponseMode, ResponseModeOption } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/menu";
import { composerControlButtonClass } from "@/features/ai-composer/composer-control";

type ResponseModeMenuProps = {
  mode: ResponseMode;
  modes: readonly ResponseModeOption[];
  disabled?: boolean;
  onModeChange: (mode: ResponseMode) => void;
};

type ModeCopy = {
  label: string;
  icon: typeof Zap;
};

const COPY: Record<ResponseMode, ModeCopy> = {
  quick: {
    label: "Quick",
    icon: Zap,
  },
  think: {
    label: "Think",
    icon: BrainCircuit,
  },
};

function modelDisclosure(option: ResponseModeOption) {
  if (!option.model) {
    return null;
  }
  return option.preview
    ? `${option.modelDisplayName} · Preview`
    : option.modelDisplayName;
}

export function ResponseModeMenu({
  mode,
  modes,
  disabled = false,
  onModeChange,
}: ResponseModeMenuProps) {
  const current = COPY[mode];
  const TriggerIcon = current.icon;

  function handleValueChange(value: string | null) {
    if (isResponseMode(value)) {
      onModeChange(value);
    }
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Response mode: ${current.label}`}
            className={composerControlButtonClass}
            disabled={disabled}
            size="sm"
            type="button"
            variant="outline"
          />
        }
      >
        <TriggerIcon data-icon="inline-start" />
        <span>{current.label}</span>
        <ChevronDown data-icon="inline-end" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="w-72 max-w-[calc(100vw_-_2rem)] px-1 py-1.5"
        side="top"
        sideOffset={8}
      >
        <div className="[zoom:var(--workspace-source-menu-density)]">
          <MenuGroup>
            <MenuRadioGroup onValueChange={handleValueChange} value={mode}>
              <div className="flex flex-col gap-[var(--workspace-source-menu-row-gap)]">
                {modes.map((option) => {
                  const copy = COPY[option.id];
                  const Icon = copy.icon;
                  const disclosure = modelDisclosure(option);

                  return (
                    <MenuRadioItem
                      className="group/mode h-7 rounded-lg px-2 py-1 text-[var(--workspace-dropdown-foreground)] transition-[background-color,color] duration-150 data-checked:bg-[var(--workspace-dropdown-hover)] data-highlighted:bg-[var(--workspace-dropdown-hover)] motion-reduce:transition-none"
                      indicator="none"
                      key={option.id}
                      value={option.id}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="-mx-0.5 size-4.5 shrink-0" />
                        <span className="min-w-0 truncate text-[13px] leading-5 font-medium text-[var(--workspace-composer-sources-foreground)] group-data-checked/mode:text-[var(--workspace-foreground)]">
                          {copy.label}
                        </span>
                        {disclosure && (
                          <span className="ms-auto shrink-0 text-[11px] leading-4 text-[var(--workspace-dropdown-foreground)]">
                            {disclosure}
                          </span>
                        )}
                      </span>
                    </MenuRadioItem>
                  );
                })}
              </div>
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}
