// FE-5A auth session atom over the mock auth store.
// The store (localStorage) is the source of truth; this atom mirrors it for
// React. Callers that mutate the store (login/logout/updateUser/deleteAccount)
// must also set this atom so the UI updates in the same tab.
import { atom, useAtomValue } from 'jotai';
import { getSessionUser, type MockUser } from '@/api/mock/authStore';

export const sessionUserAtom = atom<MockUser | null>(getSessionUser());

export function useAuthUser(): MockUser | null {
  return useAtomValue(sessionUserAtom);
}
