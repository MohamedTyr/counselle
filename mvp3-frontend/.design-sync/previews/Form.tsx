import { Form, Field, FieldLabel, FieldControl, Input, Textarea, Button } from "mvp3-frontend"

export function Default() {
  return (
    <Form className="flex w-96 flex-col gap-4 rounded-2xl border p-5">
      <Field>
        <FieldLabel>Scholarship name</FieldLabel>
        <FieldControl render={<Input placeholder="Coca-Cola Scholars" />} />
      </Field>
      <Field>
        <FieldLabel>Why do you qualify?</FieldLabel>
        <FieldControl render={<Textarea rows={3} placeholder="200 words…" />} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" type="button">Cancel</Button>
        <Button size="sm" type="submit">Save</Button>
      </div>
    </Form>
  )
}
