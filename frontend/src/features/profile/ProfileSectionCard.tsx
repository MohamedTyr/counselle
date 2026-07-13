import {
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ProfileObjectField } from "@/features/profile/ProfileObjectField";
import { ProfileObjectListField } from "@/features/profile/ProfileObjectListField";
import { ProfileScalarField } from "@/features/profile/ProfileScalarField";
import type { SectionConfig } from "@/features/profile/profile-field-types";
import { getAtPath } from "@/features/profile/profile-patch";

function detailCount(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (count, entry) => count + detailCount(entry),
      0,
    );
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (count, entry) => count + detailCount(entry),
      0,
    );
  }
  return 1;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One profile section (Basics, Academics, ...) as a card. Every top-level
 * field kind dispatches to the matching editor; `onFieldCommit` always
 * receives the full path from the section root so the caller can build one
 * minimal merge-patch per save (see `buildPatchAtPath`). */
export function ProfileSectionCard({
  config,
  onFieldCommit,
  value,
}: {
  config: SectionConfig;
  onFieldCommit: (path: string[], value: unknown) => void;
  value: unknown;
}) {
  const details = detailCount(value);
  const summary =
    details === 0
      ? "No details yet"
      : `${details} detail${details === 1 ? "" : "s"} added`;

  return (
    <AccordionItem
      className="border-[var(--profile-section-divider)] px-5"
      value={config.key}
    >
      <h2 className="sr-only">{config.title}</h2>
      <AccordionTrigger className="py-5 hover:bg-transparent">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold text-foreground">
            {config.title}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {config.description}
          </span>
        </span>
        <span className="ml-auto w-28 shrink-0 pt-0.5 text-right text-xs font-medium text-[var(--profile-field-helper)]">
          {summary}
        </span>
      </AccordionTrigger>
      <AccordionPanel className="pb-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          {config.fields.map((field) => {
            const fieldPath = [config.key, field.key];
            const fieldValue = getAtPath(value, [field.key]);
            const validateRelatedValue =
              config.key === "academics" &&
              (field.key === "class_rank" || field.key === "class_size")
                ? (nextValue: unknown) => {
                    const rank = finiteNumber(
                      field.key === "class_rank"
                        ? nextValue
                        : getAtPath(value, ["class_rank"]),
                    );
                    const size = finiteNumber(
                      field.key === "class_size"
                        ? nextValue
                        : getAtPath(value, ["class_size"]),
                    );
                    return rank !== null && size !== null && rank > size
                      ? "Class rank can’t be higher than class size."
                      : null;
                  }
                : undefined;

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
              );
            }

            if (field.kind === "object-list") {
              return (
                <div className="sm:col-span-2" key={field.key}>
                  <ProfileObjectListField
                    config={field}
                    onCommit={(nextValue) =>
                      onFieldCommit(fieldPath, nextValue)
                    }
                    value={fieldValue}
                  />
                </div>
              );
            }

            return (
              <div
                className={
                  field.kind === "textarea" ||
                  field.kind === "string-list" ||
                  field.kind === "multi-select"
                    ? "sm:col-span-2"
                    : undefined
                }
                key={field.key}
              >
                <ProfileScalarField
                  config={field}
                  onCommit={(nextValue) => onFieldCommit(fieldPath, nextValue)}
                  validate={validateRelatedValue}
                  value={fieldValue}
                />
              </div>
            );
          })}
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}
