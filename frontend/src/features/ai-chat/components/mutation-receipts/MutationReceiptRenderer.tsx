import type { StepData, WorkspaceMutationReceipt } from "@/api/chat/types";

import { verificationForTool, WRITE_TOOL_FAMILY } from "../write-tools";
import { MutationReceiptShell } from "./MutationReceiptShell";
import { parseMutationReceipt } from "./parseMutationReceipt";

/**
 * The one entry point `ToolWidgets.tsx` routes a known write's terminal step
 * through (plan §11.1). A marker-present-but-invalid mutation synthesizes a
 * safe "unknown" presentation here rather than falling through to a
 * success-sounding legacy row (§6.7) — this is the frontend's half of that
 * contract; the backend's half is the `unresolved` body it emits for
 * genuinely proven failures/cancellations.
 */

function synthesizedUnknown(tool: string | undefined): WorkspaceMutationReceipt {
  const family = (tool !== undefined ? WRITE_TOOL_FAMILY[tool] : undefined) ?? "task";
  return {
    v: 1,
    family,
    action: "update",
    outcome: "unknown",
    body: {
      kind: "unresolved",
      family,
      verification: verificationForTool(tool),
    },
    notices: [],
    omissions: { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 },
  };
}

export function MutationReceiptRenderer({
  isLiveSegment,
  step,
}: {
  isLiveSegment?: boolean;
  step: StepData;
}) {
  const parsed = parseMutationReceipt(step.detail?.mutation);
  const receipt = parsed ?? synthesizedUnknown(step.tool);
  return (
    <MutationReceiptShell isLiveSegment={isLiveSegment} receipt={receipt} step={step} />
  );
}
