// Vendored from upstream client/src/components/Conversations/Convo.tsx @ 197a1dc4
// Subtractions: ConversationEndpointIcon (→ no icon per brief), useShiftKey /
//   shift-instant-delete behavior, useNavigateToConvo, useUpdateConversationMutation,
//   allConversationsSelector Recoil, Constants.NEW_CONVO logic (simplified).
// Rewire: navigation → react-router useNavigate + useAtom(activeConversationIdAtom);
//   rename mutation → useRenameChatMutation; ConvoOptions wired to local handlers.
import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAtom } from 'jotai';
import { useToastContext, useMediaQuery } from '@librechat/client';
import { NotificationSeverity } from '@librechat/client/common/enum';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { areConversationRenderPropsEqual } from './utils';
import { ConvoOptions } from './ConvoOptions';
import RenameForm from './RenameForm';
import { cn } from '~/utils';
import ConvoLink from './ConvoLink';
import { activeConversationIdAtom } from '@/app/state';
import { useRenameChatMutation } from '@/api/hooks';

interface ConversationProps {
  conversation: TConversation;
  retainView: () => void;
  toggleNav: () => void;
  isGenerating?: boolean;
}

function Conversation({
  conversation,
  retainView,
  toggleNav,
  isGenerating = false,
}: ConversationProps) {
  const params = useParams();
  const navigate = useNavigate();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const currentConvoId = useMemo(() => params.conversationId, [params.conversationId]);
  const [activeConversationId, setActiveConversationId] = useAtom(activeConversationIdAtom);
  const renameMutation = useRenameChatMutation();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  // isShiftHeld stripped — shift-instant-delete behavior removed in MVP2
  const { conversationId, title = '' } = conversation;

  const [titleInput, setTitleInput] = useState(title || '');
  const [renaming, setRenaming] = useState(false);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const previousTitle = useRef(title);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (title !== previousTitle.current) {
      setTitleInput(title as string);
      previousTitle.current = title;
    }
  }, [title]);

  const isActiveConvo = useMemo(() => {
    // Simple: match URL param or jotai atom
    if (currentConvoId) {
      return currentConvoId === conversationId;
    }
    return activeConversationId === conversationId;
  }, [currentConvoId, conversationId, activeConversationId]);

  const handleRename = () => {
    setIsPopoverActive(false);
    setTitleInput(title as string);
    setRenaming(true);
  };

  const handleRenameSubmit = async (newTitle: string) => {
    if (!conversationId || newTitle === title) {
      setRenaming(false);
      return;
    }

    try {
      await renameMutation.mutateAsync({
        conversationId,
        title: newTitle.trim() || localize('com_ui_untitled'),
      });
      setRenaming(false);
    } catch (error) {
      setTitleInput(title as string);
      showToast({
        message: localize('com_ui_rename_failed'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
      setRenaming(false);
    }
  };

  const handleCancelRename = () => {
    setTitleInput(title as string);
    setRenaming(false);
  };

  const handleMouseEnter = useCallback(() => {
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  }, [hasInteracted]);

  const handleMouseLeave = useCallback(() => {
    if (!isPopoverActive) {
      setHasInteracted(false);
    }
  }, [isPopoverActive]);

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      // Don't reset if focus is moving to a child element within this container
      if (e.currentTarget.contains(e.relatedTarget as Node)) {
        return;
      }
      if (!isPopoverActive) {
        setHasInteracted(false);
      }
    },
    [isPopoverActive],
  );

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    setIsPopoverActive(open);
    if (!open) {
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container && !container.contains(document.activeElement)) {
          setHasInteracted(false);
        }
      });
    }
  }, []);

  const handleNavigation = (ctrlOrMetaKey: boolean) => {
    if (ctrlOrMetaKey && !isGenerating) {
      toggleNav();
      const baseUrl = window.location.origin;
      const path = `/c/${conversationId}`;
      window.open(baseUrl + path, '_blank');
      return;
    }

    if (currentConvoId === conversationId || isPopoverActive) {
      return;
    }

    toggleNav();

    if (typeof title === 'string' && title.length > 0) {
      document.title = title;
    }

    // Rewired: navigate to /c/:id and set active atom
    setActiveConversationId(conversationId);
    navigate(`/c/${conversationId}`);
  };

  const convoOptionsProps = {
    title,
    retainView,
    renameHandler: handleRename,
    isActiveConvo,
    conversationId,
    chatProjectId: conversation.chatProjectId,
    isPopoverActive,
    setIsPopoverActive: handlePopoverOpenChange,
    isShiftHeld: false, // shift-instant-delete stripped in MVP2
  };

  const generatingSpinner = (
    <svg
      className="h-5 w-5 flex-shrink-0 animate-spin text-text-primary"
      viewBox="0 0 24 24"
      fill="none"
      aria-label={localize('com_ui_generating')}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  let actionVisibilityClassName =
    'pointer-events-none max-w-0 scale-x-0 opacity-0 group-focus-within:pointer-events-auto group-focus-within:max-w-[60px] group-focus-within:scale-x-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:max-w-[60px] group-hover:scale-x-100 group-hover:opacity-100';
  if (isGenerating) {
    actionVisibilityClassName = 'pointer-events-none w-5 scale-x-100 opacity-100';
  } else if (isPopoverActive || isActiveConvo) {
    actionVisibilityClassName = 'pointer-events-auto scale-x-100 opacity-100';
  }

  let actionWidthClassName = '';
  // isShiftHeld stripped — shift-instant-delete removed in MVP2; always use narrow width
  if (!isGenerating) {
    actionWidthClassName = 'max-w-[28px]';
  }

  const showConvoOptions = !renaming && (hasInteracted || isActiveConvo);
  const actionContent = isGenerating
    ? generatingSpinner
    : showConvoOptions && <ConvoOptions {...convoOptionsProps} />;

  return (
    <div
      ref={containerRef}
      className={cn(
        'group relative flex h-12 w-full items-center rounded-lg outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-xheavy md:h-9',
        // Solid fill for both — no side stripe, no border, no color transition (the
        // fade smeared a trail across rows on mouse sweep). Selected stays distinct
        // via medium weight + the always-visible options button.
        isActiveConvo || isPopoverActive
          ? 'bg-surface-active-alt font-medium text-text-primary'
          : 'text-text-secondary hover:bg-surface-active-alt hover:text-text-primary',
      )}
      role="button"
      tabIndex={renaming ? -1 : 0}
      aria-label={localize('com_ui_conversation_label', {
        title: title || localize('com_ui_untitled'),
      })}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleBlur}
      onClick={(e) => {
        if (renaming) {
          return;
        }
        if (e.button === 0) {
          handleNavigation(e.ctrlKey || e.metaKey);
        }
      }}
      onKeyDown={(e) => {
        if (renaming) {
          return;
        }
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNavigation(false);
        }
      }}
      style={{ cursor: renaming ? 'default' : 'pointer' }}
      data-testid="convo-item"
    >
      {renaming ? (
        <RenameForm
          titleInput={titleInput}
          setTitleInput={setTitleInput}
          onSubmit={handleRenameSubmit}
          onCancel={handleCancelRename}
          localize={localize}
        />
      ) : (
        <ConvoLink
          isActiveConvo={isActiveConvo}
          isPopoverActive={isPopoverActive}
          title={title}
          onRename={handleRename}
          isSmallScreen={isSmallScreen}
          localize={localize}
        >
          {null /* ConversationEndpointIcon stripped in MVP2 — no per-endpoint icons */}
        </ConvoLink>
      )}
      <div
        className={cn(
          'mr-2 flex origin-left items-center justify-center',
          actionVisibilityClassName,
          actionWidthClassName,
        )}
        // Removing aria-hidden to fix accessibility issue: ARIA hidden element must not be focusable or contain focusable elements
        // but not sure what its original purpose was, so leaving the property commented out until it can be cleared safe to delete.
        // aria-hidden={!(isPopoverActive || isActiveConvo)}
      >
        {/* Only render ConvoOptions when user interacts (hover/focus) or for active conversation */}
        {actionContent}
      </div>
    </div>
  );
}

export default memo(Conversation, areConversationRenderPropsEqual);
