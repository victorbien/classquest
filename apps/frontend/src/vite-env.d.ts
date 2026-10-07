/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true"/"false" to force the login demo-account hint; unset = infer from /health. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
