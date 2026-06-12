import { createBrowserRouter, Navigate } from 'react-router-dom';
import Root from '~/routes/Root';
import StartupLayout from '~/routes/Layouts/Startup';
import { Login, Registration, RequestPasswordReset, ResetPassword } from '~/components/Auth';
import Sampler from '@/app/Sampler';
import ChatView from '@/app/ChatView';
import { useAuthUser } from '@/app/auth';

// FE-5A signup wall (PRD stories 1–2): the app shell requires a session;
// anonymous visitors land on /login. Client-side only — mock auth.
function AuthGate({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
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
]);
