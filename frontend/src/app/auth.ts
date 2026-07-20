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

export const authQueryKey = ["me"] as const;

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

export type { LoginInput, MeData, RegisterInput };
