/**
 * Type stub for `librechat-data-provider` (never installed — ADR 0020).
 * Only the handful of types the vendored files still reference after the
 * strips. Kept intentionally minimal; extend only when a newly vendored
 * file needs another member.
 */
declare module 'librechat-data-provider' {
  export type TUser = {
    id: string;
    username?: string;
    email?: string;
    name?: string;
    avatar?: string;
    role?: string;
    provider?: string;
    createdAt?: string;
    updatedAt?: string;
  };

  export type TFile = {
    file_id?: string;
    filename?: string;
    filepath?: string;
    type?: string;
    object?: string;
    bytes?: number;
    embedded?: boolean;
    width?: number;
    height?: number;
  };

  export type TStartupConfig = Record<string, unknown>;
}
