// Vendored from upstream client/src/components/Auth/SocialLoginRender.tsx @ 197a1dc4
// Subtractions: discord/facebook/github/apple/openid/saml providers (Google only — PRD story 3).
// Rewire (B5b): SocialButton onClick → fetch GET /v1/auth/google/authorize, then
//   `window.location.href = authorization_url` (the backend callback sets the
//   cookie and 302s back to '/'). An authorize failure surfaces inline.
import { useState } from 'react';
import { GoogleIcon } from '@librechat/client';

import SocialButton from './SocialButton';

import { useLocalize } from '~/hooks';
import { authErrorMessage, googleAuthorizeUrl } from '@/api/http/auth';

import { TStartupConfig } from 'librechat-data-provider';

function SocialLoginRender({
  startupConfig,
}: {
  startupConfig: TStartupConfig | null | undefined;
}) {
  const localize = useLocalize();
  const [authorizeError, setAuthorizeError] = useState<string | null>(null);

  if (!startupConfig) {
    return null;
  }

  const handleGoogleLogin = async () => {
    setAuthorizeError(null);
    try {
      const url = await googleAuthorizeUrl();
      window.location.href = url;
    } catch (error: unknown) {
      setAuthorizeError(authErrorMessage(error));
    }
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
        {authorizeError != null && (
          <div role="alert" className="mt-2 text-sm text-red-600 dark:text-red-500">
            {authorizeError}
          </div>
        )}
        <div className="mt-2">
          {startupConfig.socialLogins?.map((provider) => providerComponents[provider] || null)}
        </div>
      </>
    )
  );
}

export default SocialLoginRender;
