// Placeholder chat view — FE-2 (Composer + messages) will fill this.
import { Link } from 'react-router-dom';
import { ThemeSelector } from '@librechat/client';

export default function ChatView() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-surface-primary text-text-primary">
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
