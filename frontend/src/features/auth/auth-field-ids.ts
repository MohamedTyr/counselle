export function describedBy(
  id: string,
  description?: string,
  error?: string,
): string | undefined {
  const ids = [
    description ? `${id}-description` : undefined,
    error ? `${id}-error` : undefined,
  ].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}
