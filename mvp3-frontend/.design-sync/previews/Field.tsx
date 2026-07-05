import { Field, FieldLabel, FieldControl, FieldDescription, Input } from "mvp3-frontend"

export function Default() {
  return (
    <div className="flex w-80 flex-col gap-5">
      <Field>
        <FieldLabel>Full name</FieldLabel>
        <FieldControl render={<Input placeholder="Jordan Lee" />} />
        <FieldDescription>As it appears on your transcript.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl render={<Input type="email" defaultValue="jordan@example.edu" />} />
      </Field>
    </div>
  )
}
