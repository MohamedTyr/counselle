import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanize } from "@/features/schools/school-workspace-format";

/* The shared field component, extracted from SchoolWorkspace. */

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
