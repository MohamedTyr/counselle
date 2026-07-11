import { X } from "lucide-react";
import type React from "react";

import type { SkillCatalogEntry } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function labelForSkill(name: string, catalog: readonly SkillCatalogEntry[]) {
  return (
    catalog.find((skill) => skill.name === name)?.displayName ??
    name.replaceAll("-", " ")
  );
}

export function SelectedSkillChips({
  catalog,
  disabled = false,
  onRemove,
  selectedSkills,
}: {
  catalog: readonly SkillCatalogEntry[];
  disabled?: boolean;
  onRemove: (name: string) => void;
  selectedSkills: readonly string[];
}): React.ReactElement | null {
  if (selectedSkills.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Selected skills"
      className="flex flex-wrap gap-1.5"
      role="list"
    >
      {selectedSkills.map((name) => {
        const label = labelForSkill(name, catalog);
        return (
          <Badge
            className="h-8 gap-0.5 rounded-md border-input bg-secondary px-1.5 text-secondary-foreground"
            key={name}
            role="listitem"
            variant="outline"
          >
            <span className="max-w-48 truncate">{label}</span>
            <Button
              aria-label={`Remove ${label}`}
              className="-mr-1 size-8 rounded-md p-0"
              disabled={disabled}
              onClick={() => onRemove(name)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X data-icon="inline-start" />
            </Button>
          </Badge>
        );
      })}
    </div>
  );
}
