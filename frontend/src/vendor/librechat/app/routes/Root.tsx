// Vendored from upstream client/src/routes/Root.tsx @ 197a1dc4
// Subtractions: TermsAndConditionsModal, AssistantsMapContext, AgentsMapContext,
//   PromptGroupsProvider, SetConvoProvider, FileMapContext, useHealthCheck,
//   useAssistantsMap, useAgentsMap, useFileMap, useSearchEnabled,
//   useUserTermsQuery, useGetStartupConfig, Banner, isAuthenticated guard (FE-5).
// Rewire: sidebarExpanded Recoil → jotai sidebarExpandedAtom.
import { Outlet } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMediaQuery } from '@librechat/client';
import { UnifiedSidebar } from '~/components/UnifiedSidebar';
import { sidebarExpandedAtom } from '@/app/state';
import { ChatProvider } from '@/app/ChatContext';

export default function Root() {
  const sidebarExpanded = useAtomValue(sidebarExpandedAtom);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  return (
    <ChatProvider>
      <div className="flex" style={{ height: '100dvh' }}>
        <div className="relative z-0 flex h-full w-full overflow-hidden">
          <UnifiedSidebar />
          <div
            className="relative flex h-full max-w-full flex-1 flex-col overflow-hidden"
            style={{
              transform:
                isSmallScreen && sidebarExpanded ? 'translateX(min(85vw, 380px))' : 'none',
              transition: 'transform 300ms cubic-bezier(0.2, 0, 0, 1)',
            }}
            inert={isSmallScreen && sidebarExpanded ? '' : undefined}
          >
            <Outlet />
          </div>
        </div>
      </div>
    </ChatProvider>
  );
}
