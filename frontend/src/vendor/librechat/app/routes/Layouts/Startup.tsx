// Vendored from upstream client/src/routes/Layouts/Startup.tsx @ 197a1dc4
// Subtractions: useGetStartupConfig (config is the FE-5A fixture, isFetching
//   always false), REDIRECT_PARAM/SESSION_KEY pending-redirect check, 2FA
//   header entry.
// Rewire: isAuthenticated ← jotai session atom (mock auth); authenticated
//   users are redirected to '/' (our landing) instead of '/c/new'.
import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { TranslationKeys, useLocalize } from '~/hooks';
import AuthLayout from '~/components/Auth/AuthLayout';
import { startupConfigFixture } from '@/api/mock/fixtures/auth';
import { useAuthUser } from '@/app/auth';

const headerMap: Record<string, TranslationKeys> = {
  '/login': 'com_auth_welcome_back',
  '/register': 'com_auth_create_account',
  '/forgot-password': 'com_auth_reset_password',
  '/reset-password': 'com_auth_reset_password',
};

export default function StartupLayout() {
  const [error, setError] = useState<TranslationKeys | null>(null);
  const [headerText, setHeaderText] = useState<TranslationKeys | null>(null);
  const isAuthenticated = useAuthUser() != null;
  const startupConfig = startupConfigFixture;
  const isFetching = false;
  const startupConfigError = null;
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    document.title = startupConfig.appTitle || 'Counselle';
  }, [startupConfig.appTitle]);

  useEffect(() => {
    setError(null);
    setHeaderText(null);
  }, [location.pathname]);

  const contextValue = {
    error,
    setError,
    headerText,
    setHeaderText,
    startupConfigError,
    startupConfig,
    isFetching,
  };

  return (
    <AuthLayout
      header={headerText ? localize(headerText) : localize(headerMap[location.pathname])}
      isFetching={isFetching}
      startupConfig={startupConfig}
      startupConfigError={startupConfigError}
      pathname={location.pathname}
      error={error}
    >
      <Outlet context={contextValue} />
    </AuthLayout>
  );
}
