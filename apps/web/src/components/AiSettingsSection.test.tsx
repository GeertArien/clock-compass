// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AiProviderView, AiSettings, CodexStatus, SecretsState } from "@clock-compass/web-client/api";
import { aiSettingsQuery } from "@/lib/queries/ai-settings";
import { codexStatusQuery } from "@/lib/queries/ai";
import { AiSettingsSection, ProviderForm } from "./AiSettingsSection";
import { CodexConnect } from "./CodexConnect";

const provider = (extra: Partial<AiProviderView>): AiProviderView => ({
  id: "p1",
  name: "LiteLLM",
  kind: "openai-compatible",
  baseUrl: "https://gateway.example.com/v1",
  keySet: true,
  keyHint: "WXYZ",
  keyProblem: null,
  models: ["m"],
  warning: null,
  ...extra,
});

function renderSection(state: SecretsState, providers: AiProviderView[]) {
  const client = new QueryClient();
  const settings: AiSettings = { secrets: { state }, providers, jobs: [], switches: [] };
  client.setQueryData(aiSettingsQuery.queryKey, settings);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AiSettingsSection />
    </QueryClientProvider>,
  );
}

describe("Settings → AI and SECRETS_KEY (#103)", () => {
  it("says, at the top, whether the secret is not set or not valid; nothing when it is usable", () => {
    expect(renderSection("missing", [])).toContain("This server has no SECRETS_KEY");
    expect(renderSection("invalid", [])).toContain("is set but is not 32 bytes in base64");
    expect(renderSection("missing", [])).toContain("Providers without a key keep working.");
    expect(renderSection("ok", [])).not.toContain("SECRETS_KEY");
  });

  it("shows why a stored key is not used, case by case", () => {
    const html = renderSection("ok", [
      provider({ id: "a", name: "Old", keyProblem: "before-encryption" }),
      provider({ id: "b", name: "Moved", keyProblem: "other-secret" }),
      provider({ id: "c", name: "Fine" }),
      provider({ id: "d", name: "Ollama", keySet: false, keyHint: null }),
    ]);
    expect(html).toContain("Key stored before keys were encrypted: not used. Enter it again.");
    expect(html).toContain("Key encrypted with another SECRETS_KEY: not used. Enter it again.");
    expect(html).toContain("Key set, ends in …WXYZ");
    expect(html).toContain("No key");
  });

  it("turns the key field off without a usable secret; the rest of the form stays", () => {
    const render = (canStoreKeys: boolean) =>
      renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <ProviderForm onDone={() => {}} hasCodex canStoreKeys={canStoreKeys} />
        </QueryClientProvider>,
      );
    const off = render(false);
    expect(off).toContain("No key can be saved until the server has a valid SECRETS_KEY.");
    expect(off).toMatch(/<input[^>]*type="password"[^>]*disabled=""/);
    const tag = (html: string, needle: string) => html.match(new RegExp(`<input[^>]*${needle}[^>]*>`))?.[0] ?? "";
    expect(tag(off, 'placeholder="LiteLLM at home"')).not.toContain(' disabled=""');
    expect(tag(render(true), 'type="password"')).not.toContain(' disabled=""');
  });

  it("the ChatGPT card says why a kept sign-in is not used, offers to disconnect it, and cannot sign in without the secret", () => {
    const render = (status: CodexStatus, canSignIn: boolean) => {
      const client = new QueryClient();
      client.setQueryData(codexStatusQuery.queryKey, status);
      return renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <CodexConnect canSignIn={canSignIn} />
        </QueryClientProvider>,
      );
    };
    const old = render({ connected: false, accountId: "acc", label: null, expiresAt: null, problem: "before-encryption" }, true);
    expect(old).toContain("Signed in before sign-ins were encrypted: not used. Sign in with ChatGPT again.");
    expect(old).toContain("Disconnect");
    const none = render({ connected: false, accountId: null, label: null, expiresAt: null, problem: null }, false);
    expect(none).toContain("Signing in needs a valid SECRETS_KEY on the server.");
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Sign in with ChatGPT<\/button>/);
    expect(none).not.toContain("Disconnect");
  });
});
