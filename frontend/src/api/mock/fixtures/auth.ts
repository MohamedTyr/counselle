// FE-5A startup-config fixture — replaces upstream useGetStartupConfig().
// Only the fields the vendored Auth components actually read.
import type { TStartupConfig } from 'librechat-data-provider';

export const startupConfigFixture: TStartupConfig = {
  appTitle: 'Counselle',
  registrationEnabled: true,
  emailLoginEnabled: true,
  socialLoginEnabled: true,
  googleLoginEnabled: true,
  passwordResetEnabled: true,
  emailEnabled: false,
  minPasswordLength: 8,
  serverDomain: '',
  socialLogins: ['google'],
  interface: {},
};
