/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** This build's version (#140), set by `define` in vite.config.ts. */
declare const __APP_VERSION__: { commit: string | null; date: string | null; tag: string | null } | undefined;
