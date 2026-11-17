/**
 * The API bearer token, persisted in localStorage. Only needed when the server
 * has `API_AUTH_TOKEN` set; in local dev (no server token) it can stay empty.
 * Full auth UX is part of build-order step 6.
 */
const KEY = "clockcompass_api_token";
/** Pre-rebrand key — migrated on first read so existing devices stay signed in. */
const LEGACY_KEY = "bigrocks_api_token";

export function getToken(): string {
  if (typeof localStorage === "undefined") return "";
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null) {
    localStorage.setItem(KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
  }
  return localStorage.getItem(KEY) ?? "";
}

export function setToken(value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}
