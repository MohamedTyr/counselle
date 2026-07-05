// Pure, immutable reorder helpers shared by the activity and honor lists.

export function renumber<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, index) =>
    item.order === index + 1 ? item : { ...item, order: index + 1 },
  );
}

export function reorderById<T extends { id: string }>(
  items: T[],
  draggingId: string,
  targetId: string,
): T[] {
  if (draggingId === targetId) {
    return items;
  }

  const fromIndex = items.findIndex((item) => item.id === draggingId);
  const toIndex = items.findIndex((item) => item.id === targetId);

  if (fromIndex === -1 || toIndex === -1) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  return next;
}

export function swapByIndex<T>(
  items: T[],
  index: number,
  direction: -1 | 1,
): T[] {
  const targetIndex = index + direction;

  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const temp = next[index];
  next[index] = next[targetIndex];
  next[targetIndex] = temp;

  return next;
}

export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}
