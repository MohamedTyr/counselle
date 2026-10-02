import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PROFILE_ANSWER_GRID_CLASS } from "@/features/profile/ProfileFieldLabel";
import {
  ProfileScalarField,
  ProfileScoreHero,
} from "@/features/profile/ProfileScalarField";
import { profileDashedAddClass } from "@/features/profile/profile-control-styles";
import { hasAnyValue } from "@/features/profile/profile-facts";
import type {
  FieldConfig,
  ObjectFieldConfig,
  ScalarFieldConfig,
} from "@/features/profile/profile-field-types";
import { getAtPath } from "@/features/profile/profile-patch";
import { crossFieldValidator } from "@/features/profile/profile-validators";
import { cn } from "@/lib/utils";

type CommitField = (path: string[], value: unknown) => void;

function isObject(field: FieldConfig): field is ObjectFieldConfig {
  return field.kind === "object";
}

/** The number a tile is about: the test's first scored field with a
 * ceiling (SAT total, ACT composite, IB predicted). English tests report on
 * scales of their own, so they have none and the tile is all small fields. */
function heroField(test: ObjectFieldConfig): ScalarFieldConfig | undefined {
  return test.fields.find(
    (field): field is ScalarFieldConfig =>
      (field.kind === "int" || field.kind === "decimal") &&
      field.max !== undefined,
  );
}

/** Tests already sat render as tiles; the rest fold into one row of "+"
 * buttons, so an empty Testing section is a short row of choices rather
 * than five empty forms. Opening one is local until something is typed —
 * an untouched tile saves nothing and is folded again on the next visit. A
 * tile on screen stays on screen for the visit, even once its last value is
 * cleared, so clearing a score never pulls the field being typed in out from
 * under the cursor. */
export function ProfileScoreTiles({
  fields,
  onFieldCommit,
  path,
  value,
}: {
  fields: readonly FieldConfig[];
  onFieldCommit: CommitField;
  path: readonly string[];
  value: unknown;
}) {
  const tests = fields.filter(isObject);
  const [opened, setOpened] = useState<readonly string[]>(() =>
    tests
      .filter((test) => hasAnyValue(getAtPath(value, [test.key])))
      .map((test) => test.key),
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const isShown = (test: ObjectFieldConfig) =>
    opened.includes(test.key) || hasAnyValue(getAtPath(value, [test.key]));
  const shown = tests.filter(isShown);
  const folded = tests.filter((test) => !isShown(test));

  return (
    <div className="col-span-2 flex flex-col gap-3 sm:col-span-6">
      {shown.map((test) => (
        <ScoreTile
          autoFocus={focusKey === test.key}
          key={test.key}
          onFieldCommit={(leafPath, next) => {
            if (!opened.includes(test.key)) {
              setOpened((keys) => [...keys, test.key]);
            }
            onFieldCommit(leafPath, next);
          }}
          path={[...path, test.key]}
          sectionValue={value}
          test={test}
          value={getAtPath(value, [test.key])}
        />
      ))}
      {folded.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {folded.map((test) => {
            const hero = heroField(test);
            return (
              <Button
                aria-label={`Add ${test.label}`}
                className={cn("h-10 rounded-xl px-3.5", profileDashedAddClass)}
                key={test.key}
                onClick={() => {
                  setOpened((keys) => [...keys, test.key]);
                  setFocusKey(test.key);
                }}
                type="button"
                variant="outline"
              >
                <PlusIcon />
                {test.label}
                {hero?.max !== undefined ? (
                  <span className="text-xs font-normal text-[var(--ink-faint)] tabular-nums">
                    / {hero.max}
                  </span>
                ) : null}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ScoreTile({
  autoFocus,
  onFieldCommit,
  path,
  sectionValue,
  test,
  value,
}: {
  autoFocus: boolean;
  onFieldCommit: CommitField;
  path: string[];
  /** The committed section, for rules across fields (SAT total = parts). */
  sectionValue: unknown;
  test: ObjectFieldConfig;
  value: unknown;
}) {
  const ref = useRef<HTMLElement>(null);
  const hero = heroField(test);
  const rest = test.fields.filter(
    (field) =>
      field !== hero && field.kind !== "object" && field.kind !== "object-list",
  );

  useEffect(() => {
    if (autoFocus) {
      ref.current?.querySelector<HTMLElement>("input")?.focus();
    }
  }, [autoFocus]);

  return (
    <section
      aria-label={test.label}
      className="flex flex-col gap-4 rounded-xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-4 transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-[var(--accent-solid)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--progress-fill)_18%,transparent)] motion-reduce:transition-none sm:p-5"
      ref={ref}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-[var(--ink)]">
          {test.label}
        </h4>
        {hero ? (
          <span className="text-xs text-[var(--ink-faint)]">{hero.label}</span>
        ) : null}
      </div>
      {hero ? (
        <ProfileScoreHero
          config={hero}
          label={`${test.label} ${hero.label.toLowerCase()}`}
          onCommit={(next) => onFieldCommit([...path, hero.key], next)}
          validate={crossFieldValidator([...path, hero.key], sectionValue)}
          value={getAtPath(value, [hero.key])}
        />
      ) : null}
      {rest.length > 0 ? (
        <div className={PROFILE_ANSWER_GRID_CLASS}>
          {rest.map((field) =>
            field.kind === "object" || field.kind === "object-list" ? null : (
              <ProfileScalarField
                config={field}
                key={field.key}
                layout="compact"
                onCommit={(next) => onFieldCommit([...path, field.key], next)}
                validate={crossFieldValidator(
                  [...path, field.key],
                  sectionValue,
                )}
                value={getAtPath(value, [field.key])}
              />
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}
