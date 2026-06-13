// Vendored from upstream client/src/components/UnifiedSidebar/ConversationsSection.tsx @ 197a1dc4
// Subtractions: BookmarkNav, FavoritesList, ProjectsSection, useTitleGeneration (mock store titles),
//   useHasAccess, useAuthContext, useConversationsInfiniteQuery (→ useChatsQuery),
//   search state from Recoil (→ local state), isTyping/isSearching logic simplified.
// Rewire: conversations from @/api hooks (real GET /v1/sessions, B5c); search query → local atom;
//   sidebarExpanded → jotai; TConversation shape adapted from ChatRecord.
//   B5c: activeJobIds derived from is_generating and passed to Conversations (per-row indicator).
import { useCallback, useState, useMemo, memo, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { useMediaQuery } from '@librechat/client';
import type { List } from 'react-virtualized';
import { useLocalize } from '~/hooks';
import Conversations from '~/components/Conversations/Conversations';
import SearchBar from '~/components/Nav/SearchBar';
import { sidebarExpandedAtom } from '@/app/state';
import { useChatsQuery } from '@/api/hooks';
import type { TConversation } from 'librechat-data-provider';

const ConversationsSection = memo(() => {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const setSidebarExpanded = useSetAtom(sidebarExpandedAtom);

  const [isChatsExpanded, setIsChatsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const conversationsRef = useRef<List | null>(null);

  const { data: chatRecords = [], isLoading } = useChatsQuery();

  /** B5c: the set of session ids with a live turn (is_generating) → the per-row
   *  generating indicator. */
  const activeJobIds = useMemo(
    () => new Set(chatRecords.filter((c) => c.isGenerating).map((c) => c.conversationId)),
    [chatRecords],
  );

  /** Map our ChatRecord shape to TConversation so vendored Conversations component is unmodified. */
  const conversations = useMemo((): TConversation[] => {
    const filtered = searchQuery
      ? chatRecords.filter((c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : chatRecords;
    return filtered.map((c) => ({
      conversationId: c.conversationId,
      title: c.title,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
      endpoint: null,
    }));
  }, [chatRecords, searchQuery]);

  const toggleNav = useCallback(() => {
    if (isSmallScreen) {
      setSidebarExpanded(false);
    }
  }, [isSmallScreen, setSidebarExpanded]);

  /** No-op: mock store doesn't paginate. */
  const loadMoreConversations = useCallback(() => {}, []);
  const moveToTop = useCallback(() => {}, []);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden pb-3 pt-2"
      role="region"
      aria-label={localize('com_ui_chat_history')}
    >
      <div className="flex items-center gap-0.5 px-3">
        <SearchBar
          isSmallScreen={isSmallScreen}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>
      <div className="flex min-h-0 flex-grow flex-col overflow-hidden">
        <Conversations
          conversations={conversations}
          moveToTop={moveToTop}
          toggleNav={toggleNav}
          containerRef={conversationsRef}
          loadMoreConversations={loadMoreConversations}
          isLoading={isLoading}
          isSearchLoading={false}
          isChatsExpanded={isChatsExpanded}
          setIsChatsExpanded={setIsChatsExpanded}
          showFavorites={false}
          activeJobIds={activeJobIds}
        />
      </div>
    </div>
  );
});

ConversationsSection.displayName = 'ConversationsSection';

export default ConversationsSection;
