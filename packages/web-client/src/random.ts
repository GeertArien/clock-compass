/**
 * Random ids that work in every browser context (#114). `crypto.randomUUID`
 * and `crypto.subtle` exist only in a secure context (https or localhost);
 * the app is also opened over plain http on a home network (the README's
 * Docker setup), where only `crypto.getRandomValues` is there.
 */

/** `bytes` random bytes as lowercase hex (16 bytes: 32 characters, 128 bits). */
export function randomId(bytes = 16): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (b) => b.toString(16).padStart(2, "0")).join("");
}
