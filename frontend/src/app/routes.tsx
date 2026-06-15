import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import Root from '~/routes/Root';
import StartupLayout from '~/routes/Layouts/Startup';
import { Login, Registration, RequestPasswordReset, ResetPassword } from '~/components/Auth';
import Sampler from '@/app/Sampler';
import ChatView from '@/app/ChatView';
import { useMe } from '@/app/auth';
import { useServerThemeSeed } from '@/app/settingsSync';
import { Spinner } from '@librechat/client';

// Authed-only wrapper: runs the server-wins theme seed (settings sync, theme
// half) once `me` resolves, then renders the shell. Mounted only inside the
// authed branch so it never fires for anonymous visitors.
function AuthedShell({ children }: { children: React.ReactNode }) {
  useServerThemeSeed();
  return <>{children}</>;
}

// B5b signup wall (PRD stories 1–2): the app shell requires a session. The
// session is the cookie, resolved by `GET /v1/me`. Three states, kept distinct
// so a server hiccup never masquerades as "logged out" (FIX 1, honesty):
//   - isLoading            → spinner (the cookie is still being checked);
//   - data === null (401)  → genuinely logged out → /login;
//   - isError (non-401)    → server/network/timeout → an honest retry state,
//     NEVER a bounce to /login (the student may well be authed).
// Dev-only viz-card preview harness. Lazy + DEV-gated so it is never reachable
// in (or bundled into the entry chunk of) a production build — it exists purely
// to eyeball the cards in isolation during development. The `lazy()` calls live
// INSIDE the DEV branch so their dynamic `import()` chunks are statically dead in
// production and never leak into the bundle.
const devOnlyRoutes: RouteObject[] = import.meta.env.DEV
  ? (() => {
      const VizPreview = lazy(() => import('@/app/VizPreview'));
      const MessagePreview = lazy(() => import('@/app/MessagePreview'));
      return [
        {
          path: '/viz-preview',
          element: (
            <Suspense fallback={null}>
              <VizPreview />
            </Suspense>
          ),
        },
        {
          path: '/message-preview',
          element: (
            <Suspense fallback={null}>
              <MessagePreview />
            </Suspense>
          ),
        },
      ];
    })()
  : [];

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError, refetch } = useMe();
  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-surface-primary">
        <Spinner />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-surface-primary px-6 text-center">
        <p className="text-text-primary">
          Couldn&rsquo;t reach the server. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-2xl bg-surface-tertiary px-5 py-2 text-text-primary transition-colors hover:bg-surface-hover"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <AuthedShell>{children}</AuthedShell>;
}

export const router = createBrowserRouter([
  {
    // FE-5A: auth pages (vendored Startup layout, outside the app shell).
    element: <StartupLayout />,
    children: [
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Registration /> },
      { path: 'forgot-password', element: <RequestPasswordReset /> },
      { path: 'reset-password', element: <ResetPassword /> },
    ],
  },
  {
    // FE-1: Root layout wraps all chat routes with UnifiedSidebar + Outlet.
    path: '/',
    element: (
      <AuthGate>
        <Root />
      </AuthGate>
    ),
    children: [
      {
        // Landing: empty chat area.
        index: true,
        element: <ChatView />,
      },
      {
        // Active conversation route.
        path: 'c/:conversationId',
        element: <ChatView />,
      },
    ],
  },
  {
    // FE-0 gate page: vendored primitives rendered in both themes.
    path: '/sampler',
    element: <Sampler />,
  },
  ...devOnlyRoutes,
]);
