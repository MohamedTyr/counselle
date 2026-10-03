import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type DefaultError,
  type MutationFunctionContext,
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type MutateOptions,
} from "@tanstack/react-query";

const generations = new WeakMap<QueryClient, number>();

export function advancePrivateMutationGeneration(client: QueryClient) {
  generations.set(client, (generations.get(client) ?? 0) + 1);
}

export class PrivateMutationExpiredError extends Error {
  constructor() {
    super("The account changed before this update finished.");
    this.name = "PrivateMutationExpiredError";
  }
}

/** Capture before scheduling private work; reuse the token through queued work
 * and every async continuation. A new login by the same user is a new lifetime. */
export function capturePrivateMutationOwnership(client: QueryClient) {
  const owner = client.getQueryData<{ id: string } | null>(["me"])?.id;
  const generation = generations.get(client) ?? 0;
  const isCurrent = () =>
    owner === client.getQueryData<{ id: string } | null>(["me"])?.id &&
    generation === (generations.get(client) ?? 0);
  const assertCurrent = () => {
    if (!isCurrent()) throw new PrivateMutationExpiredError();
  };
  return { isCurrent, assertCurrent };
}

type PrivateMutationContext = MutationFunctionContext & {
  /** Recheck after every await before an optimistic cache write. */
  assertCurrent: () => void;
};
type Invocation<T> = {
  variables: T;
  isCurrent: () => boolean;
  assertCurrent: () => void;
};
type PrivateMutationOptions<TData, TError, TVariables, TResult> = Omit<
  UseMutationOptions<TData, TError, TVariables, TResult>,
  "mutationFn" | "onMutate"
> & {
  mutationFn: (
    variables: TVariables,
    context: PrivateMutationContext,
  ) => Promise<TData>;
  onMutate?: (
    variables: TVariables,
    context: PrivateMutationContext,
  ) => TResult | Promise<TResult>;
};

/** Each invocation keeps its initiating account and cache generation, even when
 * the hook unmounts or overlapping requests finish out of order. Native mutation
 * contexts remain unchanged for optimistic snapshots and caller callbacks.
 */
export function usePrivateMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TResult = unknown,
>(
  options: PrivateMutationOptions<TData, TError, TVariables, TResult>,
): UseMutationResult<TData, TError, TVariables, TResult> {
  const client = useQueryClient();
  // A callback retained by an old editor or Undo toast must never start work
  // for a new account. Normal same-account unmounts keep their Undo behavior.
  const [hookOwnership] = useState(() =>
    capturePrivateMutationOwnership(client),
  );
  const mutation = useMutation<TData, TError, Invocation<TVariables>, TResult>({
    ...options,
    mutationFn: async (call, context) => {
      call.assertCurrent();
      const data = await options.mutationFn(call.variables, {
        ...context,
        assertCurrent: call.assertCurrent,
      });
      call.assertCurrent();
      return data;
    },
    onMutate: (call, context) => {
      call.assertCurrent();
      return options.onMutate?.(call.variables, {
        ...context,
        assertCurrent: call.assertCurrent,
      }) as TResult | Promise<TResult>;
    },
    onSuccess: (data, call, result, context) => {
      if (call.isCurrent())
        return options.onSuccess?.(data, call.variables, result, context);
    },
    onError: (error, call, result, context) => {
      if (call.isCurrent())
        return options.onError?.(error, call.variables, result, context);
    },
    onSettled: (data, error, call, result, context) => {
      if (call.isCurrent())
        return options.onSettled?.(
          data,
          error,
          call.variables,
          result,
          context,
        );
    },
  });

  function invoke(
    variables: TVariables,
    callbacks?: MutateOptions<TData, TError, TVariables, TResult>,
  ) {
    if (!hookOwnership.isCurrent())
      return Promise.reject(new PrivateMutationExpiredError());
    const { isCurrent, assertCurrent } =
      capturePrivateMutationOwnership(client);
    const call = { variables, isCurrent, assertCurrent };
    return mutation
      .mutateAsync(call, {
        onSuccess: (data, _call, result, context) => {
          if (isCurrent())
            callbacks?.onSuccess?.(data, variables, result, context);
        },
        onError: (error, _call, result, context) => {
          if (isCurrent())
            callbacks?.onError?.(error, variables, result, context);
        },
        onSettled: (data, error, _call, result, context) => {
          if (isCurrent())
            callbacks?.onSettled?.(data, error, variables, result, context);
        },
      })
      .then((data) => {
        // Lifecycle callbacks can await, so check again before exposing the result
        // to a caller's own mutateAsync continuation.
        assertCurrent();
        return data;
      });
  }

  return {
    ...mutation,
    variables: mutation.variables?.variables,
    mutate: (variables, callbacks) => {
      void invoke(variables, callbacks).catch(() => undefined);
    },
    mutateAsync: invoke,
  } as UseMutationResult<TData, TError, TVariables, TResult>;
}
