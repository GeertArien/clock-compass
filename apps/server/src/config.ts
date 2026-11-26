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
  /**
   * The secret the stored AI provider keys and the ChatGPT sign-in are
   * encrypted with (#103): 32 random bytes in base64. Unset or malformed:
   * no key or sign-in can be saved, and the stored ones are not used.
   */
  secretsKey: string | undefined;
  /** Absolute or relative path to the built frontend, served in production. */
  webDistPath: string | undefined;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    authToken: env.API_AUTH_TOKEN,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: env.VAPID_SUBJECT || undefined,
    secretsKey: env.SECRETS_KEY || undefined,
    webDistPath: env.WEB_DIST_PATH,
    isProduction: env.NODE_ENV === "production",
  };
}
