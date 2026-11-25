/**
 * The API bearer token, persisted in localStorage. Only needed when the server
 * has `API_AUTH_TOKEN` set; in local dev (no server token) it can stay empty.
 * Full auth UX is part of build-order step 6.
 */
const KEY = "clockcompass_api_token";

export function getToken(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(KEY) ?? "";
}

export function setToken(value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}
