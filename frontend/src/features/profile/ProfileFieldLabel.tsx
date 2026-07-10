export function ProfileFieldLabel({
  htmlFor,
  label,
}: {
  htmlFor: string
  label: string
}) {
  return (
    <label
      className="text-xs font-medium text-muted-foreground"
      htmlFor={htmlFor}
    >
      {label}
    </label>
  )
}
