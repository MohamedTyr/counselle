// FE-5A mock auth store — localStorage-backed fixture auth (PRD stories 1–7).
// No backend: login/register accept anything and succeed instantly.
// The session lives under 'counselle:mock:auth'; deleteAccount clears every
// 'counselle:mock:*' key (PRD story: data controls clear the mock store).

export type MockUser = {
  id: string;
  name: string;
  email: string;
  provider: 'password' | 'google';
  createdAt: string;
};

const AUTH_KEY = 'counselle:mock:auth';
const MOCK_PREFIX = 'counselle:mock:';

function persist(user: MockUser): MockUser {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  return user;
}

/** Display name derived from an email local part: 'jane.doe' → 'Jane Doe'. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'Student';
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Student'
  );
}

export function getSessionUser(): MockUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as MockUser) : null;
  } catch {
    return null;
  }
}

export function login(email: string, _password: string): MockUser {
  return persist({
    id: 'mock-user-1',
    name: nameFromEmail(email),
    email,
    provider: 'password',
    createdAt: new Date().toISOString(),
  });
}

export function register(name: string, email: string, _password: string): MockUser {
  return persist({
    id: 'mock-user-1',
    name,
    email,
    provider: 'password',
    createdAt: new Date().toISOString(),
  });
}

export function loginWithGoogle(): MockUser {
  return persist({
    id: 'mock-user-google-1',
    name: 'Counselle Student',
    email: 'student@gmail.com',
    provider: 'google',
    createdAt: new Date().toISOString(),
  });
}

export function logout(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function updateUser(patch: Partial<Pick<MockUser, 'name' | 'email'>>): MockUser {
  const current = getSessionUser();
  if (!current) {
    throw new Error('updateUser called with no active session');
  }
  return persist({ ...current, ...patch });
}

export function deleteAccount(): void {
  logout();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(MOCK_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => localStorage.removeItem(key));
}
