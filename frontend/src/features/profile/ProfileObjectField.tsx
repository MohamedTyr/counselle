import { ProfileScalarField } from "@/features/profile/ProfileScalarField";
import { Separator } from "@/components/ui/separator";
import type { ObjectFieldConfig } from "@/features/profile/profile-field-types";
import { getAtPath } from "@/features/profile/profile-patch";

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
  config: ObjectFieldConfig;
  onFieldCommit: (path: string[], value: unknown) => void;
  path: readonly string[];
  value: unknown;
}) {
  return (
    <fieldset className="flex flex-col gap-4 py-1">
      <legend className="text-sm font-semibold text-[var(--profile-field-label)]">
        {config.label}
      </legend>
      <Separator className="bg-[var(--profile-section-divider)]" />
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
        {config.fields.map((field) => {
          if (field.kind === "object" || field.kind === "object-list") {
            return null;
          }
          const fieldPath = [...path, field.key];
          return (
            <ProfileScalarField
              config={field}
              key={field.key}
              onCommit={(nextValue) => onFieldCommit(fieldPath, nextValue)}
              value={getAtPath(value, [field.key])}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
