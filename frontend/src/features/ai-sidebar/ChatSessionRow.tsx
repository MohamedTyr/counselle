import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { MessageSquare } from "lucide-react";

import type { ChatSessionSummary } from "@/api/chat/types";
import { UNTITLED_CHAT_TITLE } from "@/api/chat/transport";
import { Spinner } from "@/components/ui/spinner";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { ChatSessionActions } from "./ChatSessionActions";

type ChatSessionRowProps = {
  active: boolean;
  isBusy: boolean;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
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
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className={cn("h-9 rounded-lg px-2 pr-8", active && "font-medium")}
        isActive={active}
        tooltip={title}
      >
        <Link
          aria-current={active ? "page" : undefined}
          aria-label={title}
          onClick={handleClick}
          to={to}
        >
          <MessageSquare aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {session.isGenerating && (
            <Spinner aria-label={`${title} is generating`} />
          )}
        </Link>
      </SidebarMenuButton>
      <ChatSessionActions
        isBusy={isBusy}
        onDelete={() => onDelete(session.sessionId)}
        onRename={(title) => onRename(session.sessionId, title)}
        title={title}
      />
    </SidebarMenuItem>
  );
}
