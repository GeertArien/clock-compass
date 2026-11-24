import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  loadAiModels,
  testAiProvider,
  type AiJobKey,
  type AiJobView,
  type AiProviderKind,
  type AiProviderView,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { CodexConnect } from "@/components/CodexConnect";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  CATEGORY_LABELS,
  JOB_LABELS,
  KIND_LABELS,
  aiSettingsQuery,
  removeProvider,
  saveJob,
  saveProvider,
  saveSwitch,
} from "@/lib/queries/ai-settings";
import { cn } from "@/lib/utils";

const field = "rounded-md border border-border bg-transparent px-2 py-2 text-sm";

/**
 * Settings → AI (#94): the providers with their keys and models, a provider
 * and model per AI job, and what data AI may use. Keys are typed in and never
 * shown again: a provider says only that a key is set (and, for a long key,
 * its last four characters).
 */
export function AiSettingsSection() {
  const settings = useQuery(aiSettingsQuery);
  const [adding, setAdding] = useState(false);

  if (settings.isPending) return <p className="text-xs text-muted-foreground">Loading the AI settings…</p>;
  if (settings.isError) {
    return (
      <p role="alert" className="text-xs text-muted-foreground">
        The AI settings could not be loaded: {errorMessage(settings.error)}
      </p>
    );
  }
  const { providers, jobs, switches } = settings.data;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ai-settings-title">
      <div>
        <h3 id="ai-settings-title" className="text-sm font-medium">
          AI
        </h3>
        <p className="text-xs text-muted-foreground">Providers, a model for each job, and what data AI may use.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Providers</h4>
        {providers.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground">
            No AI provider yet. Add one to use the assistant, task classification and the weekly review.
          </p>
        )}
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
        {adding ? (
          <ProviderForm onDone={() => setAdding(false)} hasCodex={providers.some((p) => p.kind === "codex")} />
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setAdding(true)}>
            Add a provider
          </Button>
        )}
      </div>

      {providers.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Model per job</h4>
          {jobs.map((j) => (
            <JobRow key={j.job} job={j} providers={providers} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What data AI may use</h4>
        <p className="text-xs text-muted-foreground">
          For every AI feature: the assistant, the other AI jobs, and agents over MCP.
        </p>
        {switches.map((s) => (
          <DataSwitch key={s.category} category={s.category} enabled={s.enabled} byDefault={s.byDefault} />
        ))}
      </div>
    </section>
  );
}

function keyLine(p: AiProviderView): string {
  if (p.kind === "codex") return "Signs in with ChatGPT";
  if (!p.keySet) return "No key";
  return p.keyHint ? `Key set, ends in …${p.keyHint}` : "Key set";
}

function ProviderCard({ provider }: { provider: AiProviderView }) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const remove = useMutation(removeProvider);

  async function test() {
    setTesting(true);
    try {
      setTestResult(await testAiProvider(provider.id));
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  if (editing) return <ProviderForm provider={provider} onDone={() => setEditing(false)} hasCodex />;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{provider.name}</span>
        <span className="text-xs text-muted-foreground">{KIND_LABELS[provider.kind]}</span>
      </div>
      {provider.baseUrl && <p className="break-all text-xs text-muted-foreground">{provider.baseUrl}</p>}
      <p className="text-xs text-muted-foreground">{keyLine(provider)}</p>
      {provider.warning && <p className="text-xs text-[var(--terra)]">{provider.warning}</p>}
      <p className="text-xs text-muted-foreground">
        {provider.models.length ? `Models: ${provider.models.join(", ")}` : "No models kept yet."}
      </p>
      {provider.kind === "codex" && <CodexConnect />}
      {testResult && (
        <p role="status" className={cn("text-xs", testResult.ok ? "text-[var(--pine)]" : "text-[var(--terra)]")}>
          {testResult.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="xs" onClick={() => void test()} disabled={testing}>
          {testing ? "Testing…" : "Test"}
        </Button>
        <Button variant="outline" size="xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirmRemove(true)} disabled={remove.isPending}>
          Remove
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${provider.name}?`}
        description="Its key is deleted. Jobs that used it fall back to the default."
        confirmLabel="Remove"
        destructive
        onConfirm={() => remove.mutate(provider)}
      />
    </div>
  );
}

/** Add a provider, or change one (its kind stays). */
function ProviderForm({ provider, onDone, hasCodex }: { provider?: AiProviderView; onDone: () => void; hasCodex: boolean }) {
  const [kind, setKind] = useState<AiProviderKind>(provider?.kind ?? "anthropic");
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState<string[]>(provider?.models ?? []);
  const [typed, setTyped] = useState("");
  const [offered, setOffered] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const save = useMutation(saveProvider);
  const codex = kind === "codex";

  async function loadModels() {
    if (!provider) return;
    setLoadError(null);
    try {
      setOffered((await loadAiModels(provider.id)).models);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  function toggle(model: string) {
    setModels((m) => (m.includes(model) ? m.filter((x) => x !== model) : [...m, model]));
  }

  function addTyped() {
    const name = typed.trim();
    if (name && !models.includes(name)) setModels((m) => [...m, name]);
    setTyped("");
  }

  function submit() {
    const input = {
      name: name.trim(),
      ...(provider ? {} : { kind }),
      ...(codex ? {} : { baseUrl: baseUrl.trim() || null }),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : removeKey ? { apiKey: null } : {}),
      models,
    };
    save.mutate({ id: provider?.id, input }, { onSuccess: onDone });
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!provider && (
        <label className="flex flex-col gap-1 text-xs font-medium">
          Kind
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as AiProviderKind)}>
            <option value="anthropic">{KIND_LABELS.anthropic}</option>
            <option value="openai-compatible">{KIND_LABELS["openai-compatible"]}</option>
            {!hasCodex && <option value="codex">{KIND_LABELS.codex}</option>}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="LiteLLM at home" maxLength={80} />
      </label>
      {!codex && (
        <label className="flex flex-col gap-1 text-xs font-medium">
          Address {kind === "anthropic" && <span className="font-normal text-muted-foreground">(optional: a proxy)</span>}
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={kind === "anthropic" ? "https://api.anthropic.com" : "http://localhost:11434/v1"}
            inputMode="url"
          />
        </label>
      )}
      {!codex && (
        <label className="flex flex-col gap-1 text-xs font-medium">
          {provider?.keySet ? "Replace the key" : "API key"}
          {kind === "openai-compatible" && <span className="font-normal text-muted-foreground">Local models usually need none.</span>}
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider?.keySet ? keyLine(provider) : ""}
          />
        </label>
      )}
      {provider?.keySet && !codex && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
          Remove the stored key
        </label>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium">Models</span>
        {models.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {models.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 text-xs"
                  onClick={() => toggle(m)}
                  aria-label={`Remove ${m}`}
                >
                  {m} ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTyped();
              }
            }}
            placeholder={codex ? "gpt-5" : "A model name"}
          />
          <Button type="button" variant="outline" size="sm" onClick={addTyped}>
            Add
          </Button>
        </div>
        {provider && !codex && (
          <Button type="button" variant="link" size="xs" className="self-start px-0" onClick={() => void loadModels()}>
            Load models from the provider
          </Button>
        )}
        {!provider && !codex && (
          <p className="text-xs text-muted-foreground">Once added, the provider can list its own models.</p>
        )}
        {loadError && <p className="text-xs text-[var(--terra)]">{loadError}</p>}
        {offered && (
          <fieldset className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
            <legend className="px-1 text-xs text-muted-foreground">Tick the models to keep</legend>
            {offered.length === 0 && <p className="text-xs text-muted-foreground">The provider listed none: type the names.</p>}
            {offered.map((m) => (
              <label key={m} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={models.includes(m)} onChange={() => toggle(m)} />
                {m}
              </label>
            ))}
          </fieldset>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending || !name.trim()}>
          {provider ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}

/** One job: its provider and model, and what it sends with the current switches. */
function JobRow({ job, providers }: { job: AiJobView; providers: AiProviderView[] }) {
  const save = useMutation(saveJob);
  const value = job.providerId && job.model ? `${job.providerId}\u0000${job.model}` : "";
  const choices = providers
    .filter((p) => !(job.job === "assistant" && p.kind === "codex"))
    .flatMap((p) => p.models.map((m) => ({ value: `${p.id}\u0000${m}`, label: `${p.name} · ${m}` })));
  const codexLeftOut = job.job === "assistant" && providers.some((p) => p.kind === "codex");

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs font-medium">
        {JOB_LABELS[job.job as AiJobKey]}
        <select
          className={field}
          value={value}
          disabled={save.isPending}
          onChange={(e) => {
            const [providerId, model] = e.target.value ? e.target.value.split("\u0000") : [null, null];
            save.mutate({ job: job.job, providerId: providerId ?? null, model: model ?? null });
          }}
        >
          <option value="">{job.job === "default" ? "None (AI off)" : "Use the default"}</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {codexLeftOut && <p className="text-xs text-muted-foreground">The ChatGPT subscription is not available for the assistant yet.</p>}
      {job.sends && (
        <p className="text-xs text-muted-foreground">
          Sends:{" "}
          {job.sends.map((s, i) => (
            <span key={s.label}>
              {i > 0 && ", "}
              <span className={cn(!s.shared && "line-through opacity-60")}>{s.label}</span>
            </span>
          ))}
        </p>
      )}
      {job.offBecause && <p className="text-xs text-[var(--terra)]">{job.offBecause}</p>}
    </div>
  );
}

function DataSwitch({ category, enabled, byDefault }: { category: string; enabled: boolean; byDefault: boolean }) {
  const save = useMutation(saveSwitch);
  const id = `ai-data-${category}`;
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={save.isPending ? !!save.variables?.enabled : enabled}
        disabled={save.isPending}
        onChange={(e) => save.mutate({ category, enabled: e.target.checked })}
      />
      <span>
        {CATEGORY_LABELS[category] ?? category}
        {!byDefault && <span className="block text-xs text-muted-foreground">Off unless you switch it on.</span>}
      </span>
    </label>
  );
}
