const cursorPrefix = "counselle:cursor:";

function cursorKey(sessionId: string) {
  return `${cursorPrefix}${sessionId}`;
}

const memoryCursors = new Map<string, string>();

export function getStoredCursor(sessionId: string) {
  const memory = memoryCursors.get(sessionId);
  if (memory !== undefined) {
    return memory;
  }
  try {
    return sessionStorage.getItem(cursorKey(sessionId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setStoredCursor(sessionId: string, id: string) {
  memoryCursors.set(sessionId, id);
  try {
    sessionStorage.setItem(cursorKey(sessionId), id);
  } catch {
    // Session storage is best-effort; memory storage still covers this page load.
  }
}

export function clearStoredCursor(sessionId: string) {
  memoryCursors.delete(sessionId);
  try {
    sessionStorage.removeItem(cursorKey(sessionId));
  } catch {
    // Best-effort cleanup.
  }
}
