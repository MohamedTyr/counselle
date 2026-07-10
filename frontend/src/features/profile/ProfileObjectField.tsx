import { ProfileScalarField } from "@/features/profile/ProfileScalarField"
import type { ObjectFieldConfig } from "@/features/profile/profile-field-types"
import { getAtPath } from "@/features/profile/profile-patch"

/** A nested profile sub-object (e.g. `basics.high_school`, `testing.sat`).
 * Every object-field's children are scalar/select/string-list in this
 * model — no field nests an object inside an object — so this stays a flat
 * fieldset rather than a recursive tree. */
export function ProfileObjectField({
  config,
  onFieldCommit,
  path,
  value,
}: {
  config: ObjectFieldConfig
  onFieldCommit: (path: string[], value: unknown) => void
  path: readonly string[]
  value: unknown
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">
        {config.label}
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {config.fields.map((field) => {
          if (field.kind === "object" || field.kind === "object-list") {
            return null
          }
          const fieldPath = [...path, field.key]
          return (
            <ProfileScalarField
              config={field}
              key={field.key}
              onCommit={(nextValue) => onFieldCommit(fieldPath, nextValue)}
              value={getAtPath(value, [field.key])}
            />
          )
        })}
      </div>
    </fieldset>
  )
}
