import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLayoutEffect, useRef, type PropsWithChildren } from "react";

import { schoolsExploreQueryKey } from "@/api/schools/explore-query-key";
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
import { workspaceKeys } from "@/api/workspace/keys";

export const authQueryKey = ["me"] as const;
export const onboardingQueryKey = ["onboarding"] as const;

/**
 * Saved Profile, workspace, and Explore data belongs to one authenticated
 * owner. Abort all active private reads before removing their cache entries
 * so an old response cannot repopulate a later session. An owner transition
 * targets the old owner's Explore key, leaving a just-started new-owner
 * request alone; logout without a known owner clears the whole Explore root.
 */
export async function discardPrivateQueryData(
  queryClient: QueryClient,
  exploreOwnerId?: string | null,
): Promise<void> {
  const privateQueryRoots = [
    exploreOwnerId === undefined
      ? schoolsExploreQueryKey
      : ([...schoolsExploreQueryKey, exploreOwnerId] as const),
    workspaceKeys.all,
    onboardingQueryKey,
  ] as const;
  await Promise.all(
    privateQueryRoots.map((queryKey) =>
      queryClient.cancelQueries({ queryKey }),
    ),
  );
  privateQueryRoots.forEach((queryKey) => {
    queryClient.removeQueries({ queryKey });
  });
}

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

/**
 * Clears private data before the browser paints an auth-owner transition,
 * preventing unscoped workspace keys from flashing A's data in B's session.
 * Explore is additionally owner-scoped at its own query key.
 */
export function AuthSessionCacheBoundary({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const me = useMe();
  const ownerId = me.isSuccess ? (me.data?.id ?? null) : undefined;
  const previousOwnerId = useRef<string | null | undefined>(undefined);

  useLayoutEffect(() => {
    if (ownerId === undefined) {
      return undefined;
    }

    const previous = previousOwnerId.current;
    previousOwnerId.current = ownerId;
    if (previous === undefined || previous === ownerId) {
      return undefined;
    }

    void discardPrivateQueryData(queryClient, previous);
    return undefined;
  }, [ownerId, queryClient]);

  return children;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await discardPrivateQueryData(queryClient);
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
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
    onSuccess: async () => {
      await discardPrivateQueryData(queryClient);
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onMutate: () => ({
      ownerId:
        queryClient.getQueryData<MeData | null>(authQueryKey)?.id ?? null,
    }),
    onSuccess: async (_data, _variables, context) => {
      const currentOwnerId =
        queryClient.getQueryData<MeData | null>(authQueryKey)?.id ?? null;
      // A late logout from A must not erase B's just-established session.
      if (currentOwnerId !== null && currentOwnerId !== context.ownerId) {
        return;
      }
      await discardPrivateQueryData(queryClient);
      queryClient.setQueryData(authQueryKey, null);
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
          ? {
              ...previous,
              settings: { ...previous.settings, onboarding: progress },
            }
          : previous,
      );
    },
  });
}

export type { LoginInput, MeData, RegisterInput };
export type {
  OnboardingCommand,
  OnboardingProgress,
} from "@/api/http/onboarding";
