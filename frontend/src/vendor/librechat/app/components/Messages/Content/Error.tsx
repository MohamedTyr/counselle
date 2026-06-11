/**
 * Vendored from upstream client/src/components/Messages/Content/Error.tsx
 * (pinned 197a1dc4), reduced: upstream parses their backend's JSON error codes
 * (balance, moderation, file limits, …) into localized strings. The MVP2
 * protocol's `error` event carries a clean human `message` (§27), so this
 * renders the text directly. The surrounding ErrorBox chrome lives in
 * MessageContent (byte-identical there).
 */
export default function Error({ text }: { text: string }) {
  return <>{text}</>;
}
