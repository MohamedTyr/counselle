import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router";

import type { ChatSessionSummary } from "@/api/chat/types";
import { UNTITLED_CHAT_TITLE } from "@/api/chat/transport";
import chatIcon from "@/assets/app-shell/chat.svg";
import { Spinner } from "@/components/ui/spinner";
import { SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

import { ChatSessionActions } from "./ChatSessionActions";

type ChatSessionRowProps = {
  active: boolean;
  isBusy: boolean;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  session: ChatSessionSummary;
};

function sessionTitle(session: ChatSessionSummary) {
  return session.title?.trim() || UNTITLED_CHAT_TITLE;
}

export function ChatSessionRow({
  active,
  isBusy,
  onDelete,
  onRename,
  session,
}: ChatSessionRowProps) {
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const title = sessionTitle(session);
  const to = `/app/ai/${session.sessionId}`;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const isModifiedOpen = event.metaKey || event.ctrlKey;
    if (!isModifiedOpen) {
      setOpenMobile(false);
      return;
    }

    event.preventDefault();
    if (session.isGenerating) {
      setOpenMobile(false);
      void navigate(to);
      return;
    }

    window.open(to, "_blank", "noopener,noreferrer");
  }

  return (
    <SidebarMenuItem className="as-chat-item">
      <Link
        aria-current={active ? "page" : undefined}
        aria-label={title}
        className="as-chat-row"
        onClick={handleClick}
        title={title}
        to={to}
      >
        <img alt="" height={17} src={chatIcon} width={17} />
        <span>{title}</span>
        {session.isGenerating && (
          <Spinner aria-label={`${title} is generating`} />
        )}
      </Link>
      <ChatSessionActions
        isBusy={isBusy}
        onDelete={() => onDelete(session.sessionId)}
        onRename={async (nextTitle) => onRename(session.sessionId, nextTitle)}
        title={title}
      />
    </SidebarMenuItem>
  );
}
