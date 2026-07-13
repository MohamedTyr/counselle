export function ProfileFieldLabel({
  htmlFor,
  label,
}: {
  htmlFor: string;
  label: string;
}) {
  return (
    <label
      className="text-sm font-medium text-[var(--profile-field-label)]"
      htmlFor={htmlFor}
    >
      {label}
    </label>
  );
}
