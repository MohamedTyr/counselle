import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card"
import { ProfileObjectField } from "@/features/profile/ProfileObjectField"
import { ProfileObjectListField } from "@/features/profile/ProfileObjectListField"
import { ProfileScalarField } from "@/features/profile/ProfileScalarField"
import type { SectionConfig } from "@/features/profile/profile-field-types"
import { getAtPath } from "@/features/profile/profile-patch"

/** One profile section (Basics, Academics, ...) as a card. Every top-level
 * field kind dispatches to the matching editor; `onFieldCommit` always
 * receives the full path from the section root so the caller can build one
 * minimal merge-patch per save (see `buildPatchAtPath`). */
export function ProfileSectionCard({
  config,
  onFieldCommit,
  value,
}: {
  config: SectionConfig
  onFieldCommit: (path: string[], value: unknown) => void
  value: unknown
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle render={<h2 />}>{config.title}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardPanel className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {config.fields.map((field) => {
          const fieldPath = [config.key, field.key]
          const fieldValue = getAtPath(value, [field.key])

          if (field.kind === "object") {
            return (
              <div className="sm:col-span-2" key={field.key}>
                <ProfileObjectField
                  config={field}
                  onFieldCommit={onFieldCommit}
                  path={fieldPath}
                  value={fieldValue}
                />
              </div>
            )
          }

          if (field.kind === "object-list") {
            return (
              <div className="sm:col-span-2" key={field.key}>
                <ProfileObjectListField
                  config={field}
                  onCommit={(nextValue) => onFieldCommit(fieldPath, nextValue)}
                  value={fieldValue}
                />
              </div>
            )
          }

          return (
            <ProfileScalarField
              config={field}
              key={field.key}
              onCommit={(nextValue) => onFieldCommit(fieldPath, nextValue)}
              value={fieldValue}
            />
          )
        })}
      </CardPanel>
    </Card>
  )
}
