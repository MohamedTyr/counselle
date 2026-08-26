import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";

import { useCreateTask } from "@/api/workspace/hooks";
import type { TaskCategory } from "@/api/workspace/types";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanize } from "@/features/schools/school-workspace-format";

/* The three shared field/display components, extracted from SchoolWorkspace. */

export function Provenance({
  provenance,
}: {
  provenance: { source: string; source_url: string; verified_at: string };
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Verified {provenance.verified_at} from{" "}
      <a
        className="underline underline-offset-3 hover:text-foreground"
        href={provenance.source_url}
        rel="noreferrer"
        target="_blank"
      >
        {provenance.source} <ExternalLink className="inline size-3" />
      </a>
    </p>
  );
}

export function FieldSelect<TValue extends string>({
  label,
  onChange,
  options,
  value,
  labels,
}: {
  label: string;
  onChange: (value: TValue) => void;
  options: readonly TValue[];
  value: TValue;
  labels?: Partial<Record<TValue, string>>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select onValueChange={(next) => onChange(next as TValue)} value={value}>
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {labels?.[option] ?? humanize(option)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </label>
  );
}

export function QuickAddTask({
  applicationId,
  category,
  requirementKind,
}: {
  applicationId: string;
  category: TaskCategory;
  requirementKind: string;
}) {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();
  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    await createTask.mutateAsync({
      application_id: applicationId,
      category,
      requirement_kind: requirementKind,
      title: trimmed,
    });
    setTitle("");
  }
  return (
    <InputGroup>
      <InputGroupAddon>
        <Plus />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={`Add task for ${humanize(requirementKind)}`}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="Add a task"
        value={title}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          disabled={!title.trim() || createTask.isPending}
          onClick={() => void submit()}
        >
          Add
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
