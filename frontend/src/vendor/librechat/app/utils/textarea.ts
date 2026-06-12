/**
 * Verbatim from upstream client/src/utils/textarea.ts (pinned 197a1dc4).
 * No changes — just placed under the ~ alias so vendored hooks can import it.
 */

/**
 * Insert text at the cursor position in a textarea.
 */
export function insertTextAtCursor(element: HTMLTextAreaElement, textToInsert: string) {
  element.focus();

  if (window.getSelection() && document.queryCommandSupported('insertText')) {
    document.execCommand('insertText', false, textToInsert);
  } else {
    const startPos = element.selectionStart;
    const endPos = element.selectionEnd;
    const beforeText = element.value.substring(0, startPos);
    const afterText = element.value.substring(endPos);
    element.value = beforeText + textToInsert + afterText;
    element.selectionStart = element.selectionEnd = startPos + textToInsert.length;
    const event = new Event('input', { bubbles: true });
    element.dispatchEvent(event);
  }
}

export const forceResize = (element: HTMLTextAreaElement | null) => {
  if (!element) {
    return;
  }
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
};

export const checkIfScrollable = (element: HTMLTextAreaElement | null) => {
  if (!element) {
    return false;
  }
  return element.scrollHeight > element.clientHeight;
};
