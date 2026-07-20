import {
  Check,
  ChevronDown,
  Globe2,
  GraduationCap,
  MessageCircle,
  Search,
} from "lucide-react";

import { FULL_SUBREDDIT_MENU } from "@/api/chat/source-config";
import type { SourceConfig, Subreddit } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import { Menu, MenuGroup, MenuPopup, MenuTrigger } from "@/components/ui/menu";

type SourceKey = "webSearch" | "eduSources" | "reddit";

type SourceOption = {
  key: SourceKey;
  label: string;
  icon: typeof Globe2;
};

type SourcesMenuProps = {
  disabled?: boolean;
  onSourceConfigChange: (config: SourceConfig) => void;
  sourceConfig: SourceConfig;
};

const sourceOptions: readonly SourceOption[] = [
  { key: "webSearch", label: "Web search", icon: Globe2 },
  { key: "eduSources", label: ".edu sources", icon: GraduationCap },
  { key: "reddit", label: "Reddit communities", icon: MessageCircle },
];

function sourceMenuLabel(sourceConfig: SourceConfig) {
  const enabledSources = sourceOptions
    .filter((source) => sourceConfig[source.key])
    .map((source) => source.label);

  return enabledSources.length === 0
    ? "Sources, none selected"
    : `Sources: ${enabledSources.join(", ")}`;
}

export function SourcesMenu({
  disabled = false,
  onSourceConfigChange,
  sourceConfig,
}: SourcesMenuProps) {
  function toggleSource(key: SourceKey) {
    onSourceConfigChange({ ...sourceConfig, [key]: !sourceConfig[key] });
  }

  function toggleSubreddit(subreddit: Subreddit) {
    const selectedSubreddits = sourceConfig.selectedSubreddits.includes(
      subreddit,
    )
      ? sourceConfig.selectedSubreddits.filter((entry) => entry !== subreddit)
      : [...sourceConfig.selectedSubreddits, subreddit];

    onSourceConfigChange({ ...sourceConfig, selectedSubreddits });
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={sourceMenuLabel(sourceConfig)}
            className="h-8 !rounded-[var(--workspace-composer-control-radius)] !border-[var(--workspace-composer-control-border)] !bg-[var(--workspace-composer-control-surface)] px-2.5 text-[13px] font-medium tracking-[-0.01em] !text-[var(--workspace-composer-sources-foreground)] !shadow-none before:!rounded-[calc(var(--workspace-composer-control-radius)-1px)] before:!shadow-none hover:!border-[var(--workspace-composer-control-hover-border)] hover:!bg-[var(--workspace-composer-control-hover-surface)] hover:!text-[var(--workspace-composer-sources-foreground)] data-pressed:!border-[var(--workspace-composer-control-hover-border)] data-pressed:!bg-[var(--workspace-composer-control-hover-surface)] data-popup-open:!border-[var(--workspace-composer-control-hover-border)] data-popup-open:!bg-[var(--workspace-composer-control-hover-surface)] data-popup-open:!text-[var(--workspace-composer-sources-foreground)] sm:h-8"
            disabled={disabled}
            size="sm"
            type="button"
            variant="outline"
          />
        }
      >
        <Search data-icon="inline-start" />
        <span>Sources</span>
        <ChevronDown data-icon="inline-end" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="w-72 px-1 py-1.5"
        side="top"
        sideOffset={8}
      >
        <div className="[zoom:var(--workspace-source-menu-density)]">
          <MenuGroup>
            <div className="flex flex-col gap-[var(--workspace-source-menu-row-gap)]">
              {sourceOptions.map((source) => {
                const Icon = source.icon;
                const isSelected = sourceConfig[source.key];

                return (
                  <Button
                    aria-checked={isSelected}
                    className="h-7 w-full justify-between rounded-lg px-2 text-[13px] text-[var(--workspace-dropdown-foreground)] hover:bg-[var(--workspace-dropdown-hover)] hover:text-[var(--workspace-dropdown-foreground)] sm:h-7 sm:text-[13px]"
                    key={source.key}
                    onClick={() => toggleSource(source.key)}
                    role="menuitemcheckbox"
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-4.5" />
                      {source.label}
                    </span>
                    <span className="flex size-3.5 items-center justify-center">
                      {isSelected && <Check className="size-3.5" />}
                    </span>
                  </Button>
                );
              })}
            </div>
          </MenuGroup>

          {sourceConfig.reddit && (
            <MenuGroup>
              <div className="flex flex-wrap gap-x-1.5 gap-y-[var(--workspace-source-menu-chip-row-gap)] px-2 pt-2.5 pb-1.5">
                {FULL_SUBREDDIT_MENU.map((subreddit) => {
                  const isSelected =
                    sourceConfig.selectedSubreddits.includes(subreddit);

                  return (
                    <Button
                      aria-checked={isSelected}
                      className="h-6 rounded-full border border-transparent px-1.5 text-[11px] font-medium text-[var(--workspace-dropdown-foreground)] hover:bg-[var(--workspace-dropdown-hover)] hover:text-[var(--workspace-dropdown-foreground)] data-checked:border-[var(--workspace-border)] data-checked:bg-[var(--workspace-surface-active)] data-checked:text-[var(--workspace-dropdown-foreground)] sm:h-6"
                      data-checked={isSelected ? "" : undefined}
                      key={subreddit}
                      onClick={() => toggleSubreddit(subreddit)}
                      role="menuitemcheckbox"
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      {subreddit.replace(/^r\//, "")}
                    </Button>
                  );
                })}
              </div>
            </MenuGroup>
          )}
        </div>
      </MenuPopup>
    </Menu>
  );
}
