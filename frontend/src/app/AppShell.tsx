import { Link } from 'react-router-dom';
import { ThemeSelector } from '@librechat/client';

/**
 * FE-0 bare shell: empty sidebar column + empty chat column + theme control.
 * FE-1 replaces this with the vendored Root layout + UnifiedSidebar.
 */
export default function AppShell() {
  return (
    <div className="flex h-dvh w-full bg-surface-primary text-text-primary">
      <aside className="hidden w-64 flex-shrink-0 border-r border-border-light bg-surface-primary-alt md:flex md:flex-col" />
      <main className="relative flex h-full grow flex-col items-center justify-center">
        <p className="text-text-secondary">Counselle — FE-0 substrate</p>
        <Link to="/sampler" className="mt-2 text-sm text-text-tertiary underline">
          primitives sampler
        </Link>
        <div className="absolute right-4 top-4">
          <ThemeSelector returnThemeOnly />
        </div>
      </main>
    </div>
  );
}
