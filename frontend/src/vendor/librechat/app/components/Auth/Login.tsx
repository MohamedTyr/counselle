// Vendored from upstream client/src/components/Auth/Login.tsx @ 197a1dc4
// Subtractions: OpenID auto-redirect block, OAuth-error toast effect,
//   redirect_to session persistence, useAuthContext error state (mock login
//   cannot fail — getLoginError/ErrorMessage branch dropped with it).
// Rewire: login → mock authStore login() + navigate('/') (in LoginForm).
import { registerPage } from 'librechat-data-provider';
import { useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import { useLocalize } from '~/hooks';
import LoginForm from './LoginForm';

function Login() {
  const localize = useLocalize();
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();

  return (
    <>
      {startupConfig?.emailLoginEnabled === true && (
        <LoginForm startupConfig={startupConfig} />
      )}
      {startupConfig?.registrationEnabled === true && (
        <p className="my-4 text-center text-sm font-light text-gray-700 dark:text-white">
          {' '}
          {localize('com_auth_no_account')}{' '}
          <a
            href={registerPage()}
            className="inline-flex p-1 text-sm font-medium text-green-600 underline decoration-transparent transition-all duration-200 hover:text-green-700 hover:decoration-green-700 focus:text-green-700 focus:decoration-green-700 dark:text-green-500 dark:hover:text-green-400 dark:hover:decoration-green-400 dark:focus:text-green-400 dark:focus:decoration-green-400"
          >
            {localize('com_auth_sign_up')}
          </a>
        </p>
      )}
    </>
  );
}

export default Login;
