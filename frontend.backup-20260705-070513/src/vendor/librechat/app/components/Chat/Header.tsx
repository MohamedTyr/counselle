/**
 * Vendored from upstream client/src/components/Chat/Header.tsx (pinned 197a1dc4).
 *
 * Subtractions:
 * - ModelSelector / PresetsMenu / BookmarkMenu removed (no endpoint concept)
 * - AddMultiConvo / ExportAndShareMenu / TemporaryChat removed
 * - useGetStartupConfig removed
 * - hasAccess* permission checks removed
 * - navVisible (sidebar expanded) check — OpenSidebar shown on small screens always
 * - Large-screen right-side section removed (empty in MVP2)
 *
 * Kept byte-identical:
 * - Outer div classes (gradient, height, z-index, padding)
 * - OpenSidebar position (small screen, left slot)
 */
import { memo } from 'react';
import { useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';

function Header() {
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  return (
    <div className="via-presentation/70 md:from-presentation/80 md:via-presentation/50 2xl:from-presentation/0 absolute top-0 z-10 flex h-[52px] w-full items-center justify-between bg-gradient-to-b from-presentation to-transparent p-2 font-semibold text-text-primary 2xl:via-transparent">
      <div className="hide-scrollbar flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center">
          {isSmallScreen ? <OpenSidebar /> : null}
        </div>
        <div />
      </div>
      <div />
    </div>
  );
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;
