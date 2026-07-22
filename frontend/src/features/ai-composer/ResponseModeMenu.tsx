import { BrainCircuit, ChevronDown, Zap } from "lucide-react";

import { isResponseMode } from "@/api/chat/response-mode";
import type { ResponseMode, ResponseModeOption } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import {
  Menu,
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
  description: string;
  icon: typeof Zap;
};

const COPY: Record<ResponseMode, ModeCopy> = {
  quick: {
    label: "Quick",
    description: "Fast answers for everyday questions.",
    icon: Zap,
  },
  think: {
    label: "Think",
    description: "More time for complex comparisons and important decisions.",
    icon: BrainCircuit,
  },
};

function modeLabel(mode: ResponseMode) {
  return COPY[mode].label;
}

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
        className="w-80 px-1 py-1.5"
        side="top"
        sideOffset={8}
      >
        <MenuRadioGroup onValueChange={handleValueChange} value={mode}>
          <div className="flex flex-col gap-1">
            {modes.map((option) => {
              const copy = COPY[option.id];
              const Icon = copy.icon;
              const disclosure = modelDisclosure(option);

              return (
                <MenuRadioItem
                  className="min-h-16 items-start rounded-lg py-2 pe-2"
                  key={option.id}
                  value={option.id}
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <Icon className="mt-0.5" data-icon="inline-start" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{copy.label}</span>
                      <span className="text-[12px] leading-4 text-muted-foreground">
                        {copy.description}
                      </span>
                      {disclosure && (
                        <span className="text-[11px] leading-4 text-muted-foreground">
                          {disclosure}
                        </span>
                      )}
                    </span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </div>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
