import { versionOf, type BuildVersion } from "@clock-compass/web-client/version";

/**
 * This device's app version (#140), baked in at build time. A build or a test
 * without the `define` reads as unknown.
 */
export const appVersion: BuildVersion = versionOf(typeof __APP_VERSION__ === "undefined" ? null : __APP_VERSION__);
