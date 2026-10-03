import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import {
  authErrorMessage,
  isAuthError,
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

import { toast } from "sonner";
import { bindHttpAccount } from "@/api/http/account-binding";
import { ACCOUNT_CHANGED_MESSAGE } from "@/api/http/errors";
import {
  advancePrivateMutationGeneration,
  usePrivateMutation,
} from "@/app/private-mutations";

export const authQueryKey = ["me"] as const;
export const onboardingQueryKey = ["onboarding"] as const;

/** Catalog facts and public config are identical for every account. All other
 * query domains are private by default, including future features and admin data.
 * Cancel the identity read too: a late /me response must not undo sign-out.
 */
export async function discardPrivateQueryData(
  queryClient: QueryClient,
  cancelIdentity = true,
): Promise<void> {
  advancePrivateMutationGeneration(queryClient);
  const isShared = (key: readonly unknown[]) =>
    key[0] === "school-facts" ||
    (key[0] === "schools" && ["explore", "majors"].includes(String(key[1]))) ||
    (key[0] === "config" && key[1] === "public");
  const cancelled = queryClient.cancelQueries({
    predicate: (query) =>
      !isShared(query.queryKey) &&
      (cancelIdentity || query.queryKey[0] !== "me"),
  });
  // Removal is synchronous so an owner notification cannot render stale caches.
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] !== "me" && !isShared(query.queryKey),
  });
  await cancelled;
}

/** Keep this notice outside the account subtree, which remounts on a new owner. */
export function handleAccountChanged(
  error: unknown,
  queryClient: QueryClient,
): boolean {
  if (!isAuthError(error) || error.code !== "ACCOUNT_CHANGED") return false;
  toast.error(authErrorMessage(error), { id: "account-changed" });
  void queryClient.invalidateQueries({ queryKey: authQueryKey });
  return true;
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

/** Clear caches during the identity notification, before descendants read the
 * next owner's data. Protected routes separately remount their local state.
 */
export function AuthSessionCacheBoundary({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  useMe();
  const [boundClient, setBoundClient] = useState<QueryClient | null>(null);
  const previousOwnerId = useRef(
    queryClient.getQueryData<MeData | null>(authQueryKey)?.id ??
      (queryClient.getQueryData(authQueryKey) === null ? null : undefined),
  );

  useLayoutEffect(() => {
    const release = bindHttpAccount(
      () => queryClient.getQueryData<MeData | null>(authQueryKey)?.id,
      () => {
        toast.error(ACCOUNT_CHANGED_MESSAGE, { id: "account-changed" });
        void queryClient.invalidateQueries({ queryKey: authQueryKey });
      },
    );
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        event.query.queryKey[0] !== "me" ||
        event.query.state.status !== "success"
      )
        return;
      const ownerId = (event.query.state.data as MeData | null)?.id ?? null;
      const previous = previousOwnerId.current;
      previousOwnerId.current = ownerId;
      if (previous !== undefined && previous !== ownerId) {
        void discardPrivateQueryData(queryClient, false);
      }
    });
    // Private children mount only after their transport owner is registered.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- One mount gate ensures child requests cannot precede the external transport binding.
    setBoundClient(queryClient);
    return () => {
      unsubscribe();
      release();
    };
  }, [queryClient]);

  return boundClient === queryClient ? children : null;
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
  const displayedOwner = useAuthUser()?.id ?? null;
  const mutation = useMutation({
    mutationFn: (ownerId: string | null) => logout(ownerId ?? undefined),
    onMutate: (ownerId: string | null) => ({ ownerId }),
    onError: (error) => {
      handleAccountChanged(error, queryClient);
    },
    onSuccess: async (_data, _variables, context) => {
      const currentOwnerId =
        queryClient.getQueryData<MeData | null>(authQueryKey)?.id ?? null;
      // A late logout from A must not erase B's just-established session.
      if (currentOwnerId !== null && currentOwnerId !== context.ownerId) {
        return;
      }
      await discardPrivateQueryData(queryClient);
      const ownerAfterDiscard = queryClient.getQueryData<MeData | null>(
        authQueryKey,
      )?.id;
      if (ownerAfterDiscard && ownerAfterDiscard !== context.ownerId) return;
      queryClient.setQueryData(authQueryKey, null);
    },
  });
  return {
    ...mutation,
    mutate: (
      _variables?: void,
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate(displayedOwner, options),
    mutateAsync: (
      _variables?: void,
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) => mutation.mutateAsync(displayedOwner, options),
  };
}

/** Updates the onboarding-specific cache and the nested `settings.onboarding`
 * inside `authQueryKey`'s cached `MeData`, immutably (plan §20.1). No
 * optimistic update: the server owns `current_step`/timestamps. */
export function useUpdateOnboardingProgress() {
  const queryClient = useQueryClient();
  return usePrivateMutation({
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
