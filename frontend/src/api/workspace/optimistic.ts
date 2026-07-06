export function replaceById<T extends { id: string }>(
  items: T[] | undefined,
  id: string,
  nextItem: T,
): T[] {
  if (!items) {
    return [nextItem]
  }
  return items.map((item) => (item.id === id ? nextItem : item))
}

export function patchById<T extends { id: string }>(
  items: T[] | undefined,
  id: string,
  patch: Partial<T>,
): T[] | undefined {
  if (!items) {
    return items
  }
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

export function removeById<T extends { id: string }>(
  items: T[] | undefined,
  id: string,
): T[] | undefined {
  if (!items) {
    return items
  }
  return items.filter((item) => item.id !== id)
}

export function insertAtStart<T>(items: T[] | undefined, item: T): T[] {
  return [item, ...(items ?? [])]
}

export function appendItem<T>(items: T[] | undefined, item: T): T[] {
  return [...(items ?? []), item]
}

export function replaceTempById<T extends { id: string }>(
  items: T[] | undefined,
  tempId: string,
  item: T,
): T[] {
  const current = items ?? []
  return current.some((entry) => entry.id === tempId)
    ? current.map((entry) => (entry.id === tempId ? item : entry))
    : [item, ...current]
}

export function nowIso() {
  return new Date().toISOString()
}
