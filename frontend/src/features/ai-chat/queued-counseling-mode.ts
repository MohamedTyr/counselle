import { isCounselingModeSkillName } from "@/api/chat/counseling-mode";

const STORAGE_PREFIX = "counselle:queued-counseling-mode";

function storageKey(sessionId: string, userMessageId: string) {
  return `${STORAGE_PREFIX}:${sessionId}:${userMessageId}`;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberQueuedCounselingMode(
  sessionId: string,
  userMessageId: string,
  modeSkill: string,
) {
  if (!isCounselingModeSkillName(modeSkill)) {
    return;
  }
  try {
    sessionStorageOrNull()?.setItem(
      storageKey(sessionId, userMessageId),
      modeSkill,
    );
  } catch {
    // Optional refresh bridge only; the in-memory mapping still handles
    // the current page when storage is unavailable.
  }
}

export function readQueuedCounselingMode(
  sessionId: string,
  userMessageId: string,
): string | null {
  let modeSkill: string | null;
  try {
    modeSkill =
      sessionStorageOrNull()?.getItem(storageKey(sessionId, userMessageId)) ??
      null;
  } catch {
    return null;
  }
  return modeSkill !== null && isCounselingModeSkillName(modeSkill)
    ? modeSkill
    : null;
}

export function forgetQueuedCounselingMode(
  sessionId: string,
  userMessageId: string,
) {
  try {
    sessionStorageOrNull()?.removeItem(storageKey(sessionId, userMessageId));
  } catch {
    // The optional bridge may already be unavailable; there is nothing else
    // to clean up.
  }
}
