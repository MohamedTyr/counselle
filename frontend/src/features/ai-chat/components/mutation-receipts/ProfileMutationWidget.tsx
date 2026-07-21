import type { WorkspaceMutationReceipt } from "@/api/chat/types";

import { ChangeList } from "./MutationReceiptBody";

/**
 * Profile-family anatomy (plan §9.7): a section index followed by
 * section-grouped definition lists — never a flat list of every profile
 * field. Reuses the shared `ChangeList` field-row renderer per section so
 * the `MutationValue` formatting logic has exactly one implementation.
 */
export function ProfileMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  const { body } = receipt;
  if (body.kind !== "profile") return null;

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {body.sections.map((section) => section.section_label).join(" · ")}
      </p>
      {body.sections.map((section) => (
        <section aria-label={section.section_label} key={section.section_key}>
          <h4 className="pb-1 text-xs font-medium text-muted-foreground">
            {section.section_label}
          </h4>
          <ChangeList changes={section.changes} />
        </section>
      ))}
    </div>
  );
}
