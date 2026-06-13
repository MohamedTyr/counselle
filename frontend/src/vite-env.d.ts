/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Transport seam selector (B5a): 'http' (default) | 'mock'. */
  readonly VITE_TRANSPORT?: 'http' | 'mock';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
