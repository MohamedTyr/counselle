import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchMe,
  login,
  logout,
  register,
  type LoginInput,
  type MeData,
  type RegisterInput,
} from "@/api/http/auth";
import {
  patchOnboarding,
  type OnboardingCommand,
  type OnboardingProgress,
} from "@/api/http/onboarding";

export const authQueryKey = ["me"] as const;
export const onboardingQueryKey = ["onboarding"] as const;

export class AccountCreatedLoginError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Account created, but automatic login failed.");
    this.name = "AccountCreatedLoginError";
    this.cause = cause;
  }
}

export function isAccountCreatedLoginError(
  error: unknown,
): error is AccountCreatedLoginError {
  return error instanceof AccountCreatedLoginError;
}

export function useMe(): UseQueryResult<MeData | null> {
  return useQuery({
    queryKey: authQueryKey,
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });
}

export function useAuthUser(): MeData | null {
  return useMe().data ?? null;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authQueryKey }),
  });
}

export function useRegisterAndLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      await register(input);
      try {
        await login({ email: input.email, password: input.password });
      } catch (error) {
        throw new AccountCreatedLoginError(error);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authQueryKey }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: authQueryKey });
    },
  });
}

/** Updates the onboarding-specific cache and the nested `settings.onboarding`
 * inside `authQueryKey`'s cached `MeData`, immutably (plan §20.1). No
 * optimistic update: the server owns `current_step`/timestamps. */
export function useUpdateOnboardingProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: OnboardingCommand) => patchOnboarding(command),
    onSuccess: (progress: OnboardingProgress) => {
      queryClient.setQueryData(onboardingQueryKey, progress);
      queryClient.setQueryData<MeData | null>(authQueryKey, (previous) =>
        previous
          ? { ...previous, settings: { ...previous.settings, onboarding: progress } }
          : previous,
      );
    },
  });
}

export type { LoginInput, MeData, RegisterInput };
export type { OnboardingCommand, OnboardingProgress } from "@/api/http/onboarding";
