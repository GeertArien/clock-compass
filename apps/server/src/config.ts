/** Server configuration, read once from the environment. */
export interface ServerConfig {
  port: number;
  host: string;
  /** Bearer token required on protected routes. */
  authToken: string | undefined;
  /** Force a provider: "anthropic" | "openai-compatible". Unset = infer from keys. */
  aiProvider: string | undefined;
  /** Anthropic key for the AI jobs; unset = AI disabled (Noop provider). */
  anthropicApiKey: string | undefined;
  /** Optional Anthropic model override. */
  anthropicModel: string | undefined;
  /** OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, OpenRouter, LiteLLM…). */
  openaiBaseUrl: string | undefined;
  /** Optional — local runtimes usually need none. */
  openaiApiKey: string | undefined;
  /** Model name as the OpenAI-compatible endpoint knows it. */
  openaiModel: string | undefined;
  /** Model for the Codex (ChatGPT subscription) provider; defaults to gpt-5. */
  codexModel: string | undefined;
  /** VAPID keys for web push; unset = push disabled. */
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  vapidSubject: string | undefined;
  /** Absolute or relative path to the built frontend, served in production. */
  webDistPath: string | undefined;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    authToken: env.API_AUTH_TOKEN,
    aiProvider: env.AI_PROVIDER || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || undefined,
    openaiBaseUrl: env.OPENAI_BASE_URL || undefined,
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiModel: env.OPENAI_MODEL || undefined,
    codexModel: env.CODEX_MODEL || undefined,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: env.VAPID_SUBJECT || undefined,
    webDistPath: env.WEB_DIST_PATH,
    isProduction: env.NODE_ENV === "production",
  };
}
