// Vendored from upstream client/src/components/Auth/SocialLoginRender.tsx @ 197a1dc4
// Subtractions: discord/facebook/github/apple/openid/saml providers (Google only — PRD story 3).
// Rewire: SocialButton href → onClick calling mock loginWithGoogle() + navigate('/').
import { GoogleIcon } from '@librechat/client';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';

import SocialButton from './SocialButton';

import { useLocalize } from '~/hooks';
import { loginWithGoogle } from '@/api/mock/authStore';
import { sessionUserAtom } from '@/app/auth';

import { TStartupConfig } from 'librechat-data-provider';

function SocialLoginRender({
  startupConfig,
}: {
  startupConfig: TStartupConfig | null | undefined;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const setSessionUser = useSetAtom(sessionUserAtom);

  if (!startupConfig) {
    return null;
  }

  const handleGoogleLogin = () => {
    setSessionUser(loginWithGoogle());
    navigate('/', { replace: true });
  };

  const providerComponents = {
    google: startupConfig.googleLoginEnabled && (
      <SocialButton
        key="google"
        enabled={startupConfig.googleLoginEnabled}
        onClick={handleGoogleLogin}
        Icon={GoogleIcon}
        label={localize('com_auth_google_login')}
        id="google"
      />
    ),
  };

  return (
    startupConfig.socialLoginEnabled && (
      <>
        {startupConfig.emailLoginEnabled && (
          <>
            <div className="relative mt-6 flex w-full items-center justify-center border border-t border-gray-300 uppercase dark:border-gray-600">
              <div className="absolute bg-white px-3 text-xs text-black dark:bg-gray-900 dark:text-white">
                Or
              </div>
            </div>
            <div className="mt-8" />
          </>
        )}
        <div className="mt-2">
          {startupConfig.socialLogins?.map((provider) => providerComponents[provider] || null)}
        </div>
      </>
    )
  );
}

export default SocialLoginRender;
