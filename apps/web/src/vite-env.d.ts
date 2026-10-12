/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_UI_LOCALE?: string;
  readonly SCREEN_VIEWER_STATIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.po" {
  export const messages: Record<string, unknown>;
}
