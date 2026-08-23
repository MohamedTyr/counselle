import type { CSSProperties, MouseEvent } from "react";
import { Link, useNavigate } from "react-router";

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
  index: number;
  isBusy: boolean;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  session: ChatSessionSummary;
};

const MAX_STAGGER_STEPS = 8;

function sessionTitle(session: ChatSessionSummary) {
  return session.title?.trim() || UNTITLED_CHAT_TITLE;
}

export function ChatSessionRow({
  active,
  index,
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
    <SidebarMenuItem
      className="sidebar-chat-item"
      style={
        {
          "--chat-row-index": Math.min(index, MAX_STAGGER_STEPS),
        } as CSSProperties
      }
    >
      <SidebarMenuButton
        asChild
        /* 1a: 34px tall, 12px inline padding, 9px radius, 13.5px label —
         * a slightly tighter pill than a nav row, which is what separates
         * "places in the app" from "things you made". */
        className={cn(
          "sidebar-chat-button h-11 rounded-[9px] px-3 pr-1.5! text-[13.5px] text-[var(--sidebar-row-ink,var(--shell-sidebar-row-foreground-dim))] transition-[color,background-color] duration-150 md:h-[34px] pointer-coarse:!h-11 hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-ink-strong)] focus-visible:ring-2 data-active:bg-sidebar-active data-active:text-sidebar-active-foreground",
          active && "font-medium",
        )}
        isActive={active}
      >
        <Link
          aria-current={active ? "page" : undefined}
          aria-label={title}
          onClick={handleClick}
          title={title}
          to={to}
        >
          <span className="sidebar-chat-title min-w-0 flex-1 truncate">
            {title}
          </span>
          {session.isGenerating && (
            <Spinner aria-label={`${title} is generating`} />
          )}
        </Link>
      </SidebarMenuButton>
      <ChatSessionActions
        isBusy={isBusy}
        onDelete={() => onDelete(session.sessionId)}
        onRename={async (title) => onRename(session.sessionId, title)}
        title={title}
      />
    </SidebarMenuItem>
  );
}
