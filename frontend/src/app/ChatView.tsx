// Placeholder chat view — FE-2 (Composer + messages) will fill this.
import { useAtomValue } from 'jotai';
import { Link } from 'react-router-dom';
import { ThemeSelector, useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { sidebarExpandedAtom } from '@/app/state';

export default function ChatView() {
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const sidebarExpanded = useAtomValue(sidebarExpandedAtom);

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-surface-primary text-text-primary">
      {isSmallScreen && !sidebarExpanded && (
        <div className="absolute left-2 top-2">
          <OpenSidebar />
        </div>
      )}
      <p className="text-text-secondary">Ask Counselle anything about US universities.</p>
      <Link to="/sampler" className="mt-2 text-sm text-text-tertiary underline">
        primitives sampler
      </Link>
      <div className="absolute right-4 top-4">
        <ThemeSelector returnThemeOnly />
      </div>
    </div>
  );
}
