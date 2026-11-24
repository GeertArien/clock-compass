/** Server configuration, read once from the environment. */
export interface ServerConfig {
  port: number;
  host: string;
  /** Bearer token required on protected routes. */
  authToken: string | undefined;
  /** VAPID keys for web push; unset = push disabled. */
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  vapidSubject: string | undefined;
  /** Absolute or relative path to the built frontend, served in production. */
  webDistPath: string | undefined;
  isProduction: boolean;
}

/**
 * The AI environment variables of before #94. They are no longer read: AI is
 * configured in Settings → AI. The server says so once when any is set.
 */
export const RETIRED_AI_VARIABLES = [
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "CODEX_MODEL",
] as const;

/** The notice for retired AI variables that are still set (names only, never values); null when none is. */
export function retiredAiNotice(env: NodeJS.ProcessEnv = process.env): string | null {
  const set = RETIRED_AI_VARIABLES.filter((name) => env[name]);
  return set.length
    ? `${set.join(", ")} ${set.length === 1 ? "is" : "are"} no longer read. AI is now configured in Settings → AI.`
    : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    authToken: env.API_AUTH_TOKEN,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: env.VAPID_SUBJECT || undefined,
    webDistPath: env.WEB_DIST_PATH,
    isProduction: env.NODE_ENV === "production",
  };
}
