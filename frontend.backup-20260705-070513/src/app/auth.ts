/**
 * The session-user surface (B5b) — the httpOnly cookie IS the session, so the
 * signed-in user is a TanStack Query over `GET /v1/me`. No client-held token,
 * no jotai mirror: the query cache is the single source of truth, and the auth
 * mutations invalidate it so the UI flips without a reload.
 *
 * Replaces the FE-5A jotai mock-store atom (`sessionUserAtom`). `authStore.ts`
 * stays on disk as a test/Sampler fixture; nothing in the live path imports it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryKeys } from '@/api/hooks';
import { isTransportError } from '@/api/http/errors';
import {
  deleteAccount,
  fetchMe,
  login,
  logout,
  patchMe,
  register,
  type LoginInput,
  type MeData,
  type PatchMeInput,
  type RegisterInput,
} from '@/api/http/auth';

/**
 * The session query, with three distinguishable states (the AuthGate branches
 * on all three — see FIX 1):
 *   - `isLoading`            → the cookie is still being checked (spinner);
 *   - `data === null`        → a real 401 (`fetchMe` returns null) → logged out;
 *   - `isError` (data undef) → a non-401 failure (5xx/network/timeout) → an
 *     honest "couldn't reach the server" state with `refetch`, NOT a /login bounce.
 * 401 resolves to `null` data, never a thrown error, so `null` vs `isError`
 * cleanly separates "logged out" from "server hiccup". The full `UseQueryResult`
 * is returned so callers get `isError`/`error`/`refetch`.
 */
export function useMe(): UseQueryResult<MeData | null> {
  return useQuery<MeData | null>([QueryKeys.me], fetchMe, {
    staleTime: 60_000,
    cacheTime: 300_000,
    retry: false,
  });
}

/**
 * Back-compat shim for call sites that only want the user (or `null`).
 * Prefer `useMe()` where the loading/auth distinction matters (e.g. the gate).
 */
export function useAuthUser(): MeData | null {
  return useMe().data ?? null;
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Drop every session-scoped query from the cache. Used on logout/delete:
 * `removeQueries` makes `me` resolve to `undefined` IMMEDIATELY (no stale-authed
 * refetch window), so `Startup.tsx`'s `data != null` can't bounce a just-logged-
 * out user back to `/` (the redirect loop). `invalidate` would leave the stale
 * user in cache during the refetch — wrong for a session that just ended.
 */
function useClearSession(): () => void {
  const queryClient = useQueryClient();
  return () => {
    queryClient.removeQueries([QueryKeys.me]);
    queryClient.removeQueries([QueryKeys.chats]);
  };
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation((input: LoginInput) => login(input), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.me]),
  });
}

export function useRegister() {
  return useMutation((input: RegisterInput) => register(input));
}

export function useLogout() {
  const clearSession = useClearSession();
  return useMutation(() => logout(), {
    onSuccess: clearSession,
  });
}

export function usePatchMe() {
  const queryClient = useQueryClient();
  return useMutation((input: PatchMeInput) => patchMe(input), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.me]),
    // FIX 6: surface a dead session. A theme/name PATCH that 401s means the
    // cookie expired — invalidate `me` so it refetches, resolves to `null`, and
    // routes through the AuthGate. Callers may layer their own onError (mutate
    // merges both); this base handler only fires for the unauthorized case.
    onError: (error) => {
      if (isTransportError(error) && error.kind === 'unauthorized') {
        queryClient.invalidateQueries([QueryKeys.me]);
      }
    },
  });
}

export function useDeleteAccount() {
  const clearSession = useClearSession();
  return useMutation(() => deleteAccount(), {
    onSuccess: clearSession,
  });
}
