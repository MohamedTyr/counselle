/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/Container.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions: Files / SkillPills rows on user messages (file uploads and
 * skills dropped). Container classes byte-identical.
 */
import type { ChatMessage } from '@/app/ChatContext';

const Container = ({ children }: { children: React.ReactNode; message?: ChatMessage }) => (
  <div
    className="text-message flex min-h-[20px] flex-col items-start gap-3 overflow-visible [.text-message+&]:mt-5"
    dir="auto"
  >
    {children}
  </div>
);

export default Container;
