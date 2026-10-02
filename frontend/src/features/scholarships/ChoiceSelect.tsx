import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const UNSET = "__unset__";

/** A labelled single choice over `Select`, with an explicit "not set" row. */
export function ChoiceSelect<T extends string>({
  id,
  value,
  options,
  placeholder,
  onChange,
  className,
}: {
  id?: string;
  value: T | null;
  options: { value: T; label: string }[];
  placeholder: string;
  onChange: (value: T | null) => void;
  className?: string;
}) {
  const items = [{ value: UNSET, label: placeholder }, ...options];
  return (
    <Select
      items={items}
      onValueChange={(next) => onChange(next === UNSET || next === null ? null : (next as T))}
      value={value ?? UNSET}
    >
      <SelectTrigger className={className} id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup align="start">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
