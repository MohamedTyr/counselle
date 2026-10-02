import { useId, useState } from "react";
import { useNavigate } from "react-router";

import plusIcon from "@/assets/app-shell/plus.svg";
import sectionDownIcon from "@/assets/app-shell/section-down.svg";
import sectionRightIcon from "@/assets/app-shell/section-right.svg";
import vdotsIcon from "@/assets/app-shell/vdots.svg";
import { useSidebar } from "@/components/ui/sidebar";

import { ChatSessionRow } from "./ChatSessionRow";
import type { SessionGroup } from "./group-sessions";

type ChatSessionSectionProps = {
  activeSessionId: string | undefined;
  busySessionId: string | null;
  defaultOpen: boolean;
  group: SessionGroup;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
};

/** One recency bucket ("Previous 7 days", …) as a collapsible section. */
export function ChatSessionSection({
  activeSessionId,
  busySessionId,
  defaultOpen,
  group,
  onDelete,
  onRename,
}: ChatSessionSectionProps) {
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();

  return (
    <section aria-label={group.label} className="as-section">
      <div className="as-section-header">
        <button
          aria-controls={listId}
          aria-expanded={open}
          className="as-section-toggle"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <img
            alt=""
            height={15}
            src={open ? sectionDownIcon : sectionRightIcon}
            width={15}
          />
          <span>{group.label}</span>
        </button>
        <button
          aria-label="New chat"
          className="as-icon-button"
          onClick={() => {
            setOpenMobile(false);
            void navigate("/app/ai");
          }}
          type="button"
        >
          <img alt="" height={16} src={plusIcon} width={16} />
        </button>
        <img
          alt=""
          aria-hidden="true"
          className="as-icon-button"
          height={16}
          src={vdotsIcon}
          width={16}
        />
      </div>
      {open && (
        <ul className="as-chat-list" id={listId}>
          {group.sessions.map((session) => (
            <ChatSessionRow
              active={session.sessionId === activeSessionId}
              isBusy={busySessionId === session.sessionId}
              key={session.sessionId}
              onDelete={onDelete}
              onRename={onRename}
              session={session}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
