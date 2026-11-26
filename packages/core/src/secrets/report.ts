/**
 * What the server says at start about the stored secrets (#103): whether it
 * has a usable SECRETS_KEY, and how many stored keys and sign-ins cannot be
 * used and why. Counts and names of states only: never a value, never the
 * secret. Reading only: nothing is changed (there is no data migration).
 */
import type { AiSettingsRepository } from "../repositories/ai-settings-repository.js";
import type { ProviderCredentialRepository } from "../repositories/provider-credential-repository.js";
import { CODEX_PROVIDER } from "../ai/codex-provider.js";
import { credentialPlace, providerKeyPlace, type SecretsBox, type Unreadable } from "./box.js";

const keys = (n: number) => `${n} provider key${n === 1 ? "" : "s"}`;

/** The start-up lines about stored secrets; empty when all is well. */
export async function secretsReport(
  box: SecretsBox,
  providers: Pick<AiSettingsRepository, "listProviders" | "secretFor">,
  credentials: Pick<ProviderCredentialRepository, "get">,
): Promise<string[]> {
  const lines: string[] = [];
  if (box.state !== "ok") {
    const why = box.state === "missing" ? "SECRETS_KEY is not set" : "SECRETS_KEY is set but is not 32 bytes in base64, so it is not used";
    lines.push(
      `${why}: AI providers with a key and the ChatGPT sign-in are off, and no key or sign-in can be saved until it is set (see the README, Secrets). Providers without a key keep working.`,
    );
  }

  const counts: Record<Unreadable, number> = { "before-encryption": 0, "other-secret": 0, damaged: 0, "no-secret": 0 };
  for (const p of await providers.listProviders()) {
    if (!p.keySet) continue;
    const stored = await providers.secretFor(p.id);
    if (stored === null) continue;
    const opened = box.open(stored, providerKeyPlace(p.id));
    if (!opened.ok) counts[opened.why] += 1;
  }
  const signIn = await credentials.get(CODEX_PROVIDER);
  let signInWhy: Unreadable | null = null;
  if (signIn) {
    for (const field of ["accessToken", "refreshToken"] as const) {
      const opened = box.open(signIn[field], credentialPlace(field, CODEX_PROVIDER), "plain");
      if (!opened.ok) {
        signInWhy = opened.why;
        break;
      }
    }
  }

  const what = (why: Unreadable) => {
    const parts = [counts[why] ? keys(counts[why]) : "", signInWhy === why ? "the ChatGPT sign-in" : ""].filter(Boolean);
    return parts.length ? { text: parts.join(" and "), many: parts.length > 1 || counts[why] > 1 } : null;
  };
  const before = what("before-encryption");
  if (before) {
    lines.push(
      `${before.text} ${before.many ? "were" : "was"} stored before keys were encrypted: not used and not changed. ${[
        counts["before-encryption"] ? `Enter ${counts["before-encryption"] === 1 ? "the key" : "the keys"} again` : "",
        signInWhy === "before-encryption" ? "sign in to ChatGPT again" : "",
      ]
        .filter(Boolean)
        .join(" and ")
        .replace(/^s/, "S")} in Settings → AI.`,
    );
  }
  const other = what("other-secret");
  if (other) {
    lines.push(
      `${other.text} ${other.many ? "were" : "was"} encrypted with another SECRETS_KEY and cannot be read: enter ${other.many ? "them" : "it"} again in Settings → AI. Nothing was changed.`,
    );
  }
  const damaged = what("damaged");
  if (damaged) lines.push(`${damaged.text} cannot be read: enter ${damaged.many ? "them" : "it"} again in Settings → AI. Nothing was changed.`);
  const waiting = what("no-secret");
  if (waiting) lines.push(`${waiting.text} cannot be read until SECRETS_KEY is set correctly. Nothing was changed.`);
  return lines.map((line) => line.charAt(0).toUpperCase() + line.slice(1));
}
