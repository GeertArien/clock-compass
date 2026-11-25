import { Store } from "./store";

/**
 * Settings in six sections (#141): which section is open, opening Settings on
 * a section from anywhere (`openSettings("ai")`), and which forms hold typing
 * that is not saved yet. React-free; the sheet reads it with `useStore`.
 *
 * On a phone the sheet shows the list of sections until one is chosen
 * (`section` null); on desktop the list sits beside the open section, and no
 * section chosen means the first. The back gesture is the sheet's business
 * (an open section is one more history layer there).
 */
export const SETTINGS_SECTIONS = ["general", "connection", "ai", "agents", "notifications", "data"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  typeof value === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(value);

/** The address that opens Settings on a section: `?settings=ai` (any section name). */
export const SETTINGS_PARAM = "settings";

/**
 * The section an address asks for: `?settings=ai` → "ai"; `?settings` (or an
 * unknown name) → Settings on its list; undefined when the address asks for
 * nothing.
 */
export function sectionFromSearch(search: string): SettingsSection | null | undefined {
  const params = new URLSearchParams(search);
  if (!params.has(SETTINGS_PARAM)) return undefined;
  const value = params.get(SETTINGS_PARAM);
  return isSettingsSection(value) ? value : null;
}

/**
 * The section a message points to, if any, so a notice can offer to open it:
 * one naming "Settings → AI" (an AI job that is off, the ChatGPT sign-in) →
 * "ai"; a refused token → "connection".
 */
export function sectionForMessage(message: string): SettingsSection | null {
  if (/Settings → AI/.test(message)) return "ai";
  if (/\b401\b|Unauthori[sz]ed|API token/i.test(message)) return "connection";
  return null;
}

/** The next section up or down the list, wrapping (the list's arrow keys). */
export function stepSection(current: SettingsSection, step: 1 | -1): SettingsSection {
  const i = SETTINGS_SECTIONS.indexOf(current);
  return SETTINGS_SECTIONS[(i + step + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length]!;
}

export interface SettingsState {
  open: boolean;
  /** Bumped on every open: the sheet remounts and starts from what is stored. */
  key: number;
  /** The open section; null is the list (phone) or the first section (desktop). */
  section: SettingsSection | null;
  /** Forms with typing that is not saved, by name ("token", "provider", "import"). */
  dirty: ReadonlySet<string>;
  /** Push on this device, once Notifications has checked (for the list's status). */
  pushOn: boolean | null;
}

export class SettingsStore extends Store<SettingsState> {
  constructor() {
    super({ open: false, key: 0, section: null, dirty: new Set(), pushOn: null });
  }

  /** Open Settings, on a section or on the list. */
  openSettings(section: SettingsSection | null = null): void {
    // Already open (a link inside Settings, or in a notice above it): only go
    // to the section. A new key would remount the sheet and drop what is typed.
    if (this.state.open) {
      if (section) this.show(section);
      return;
    }
    this.setState({ open: true, key: this.state.key + 1, section, dirty: new Set() });
  }

  /** Close Settings at once (the sheet asks first when a form is dirty). */
  close(): void {
    this.setState({ open: false });
  }

  /** Open a section, or go back to the list (null). */
  show(section: SettingsSection | null): void {
    if (section !== this.state.section) this.setState({ section });
  }

  /** A form says whether it holds unsaved typing. */
  setDirty(form: string, dirty: boolean): void {
    if (this.state.dirty.has(form) === dirty) return;
    const next = new Set(this.state.dirty);
    if (dirty) next.add(form);
    else next.delete(form);
    this.setState({ dirty: next });
  }

  /**
   * The user asked to close Settings (the close button, Escape, a tap
   * outside, the back gesture): closes, or answers "ask" when a form holds
   * unsaved typing, for the sheet to ask "Leave without saving?" once.
   */
  requestClose(): "closed" | "ask" {
    if (this.hasUnsaved) return "ask";
    this.close();
    return "closed";
  }

  /** Whether closing Settings now would lose typing (so it asks first). */
  get hasUnsaved(): boolean {
    return this.state.dirty.size > 0;
  }

  setPushOn(on: boolean | null): void {
    if (on !== this.state.pushOn) this.setState({ pushOn: on });
  }
}

export const settingsStore = new SettingsStore();

/** Open Settings from anywhere: on a section, or on its list. */
export const openSettings = (section: SettingsSection | null = null): void => settingsStore.openSettings(section);
