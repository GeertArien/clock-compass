import {
  PrismaAiSettingsRepository,
  PrismaProviderCredentialRepository,
  PrismaStoredDayCheckRepository,
  describeFallbackZone,
  prisma,
  secretsBox,
  secretsReport,
} from "@clock-compass/core";
import { describeVersion, versionFromEnv } from "@clock-compass/core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { checkStoredDays } from "./stored-days.js";
import { checkServerZone } from "./time-zone.js";

// The first line of the log names the running version (#140).
console.log(`Clock & Compass ${describeVersion(versionFromEnv())}`);

// `TZ` is an optional override (#136): refuse a zone Node would silently
// replace with UTC.
const tzCheck = checkServerZone();
if ("error" in tzCheck) {
  console.error(tzCheck.error);
  process.exit(1);
}

// Every stored day must be a plain date (#137): one written before #112 or
// #136 would show on the wrong day. Checked before anything else touches the
// database; it only reads. In the container the entrypoint has already run the
// same check before the migrations (check-stored-days.ts); this one covers a
// start without it.
try {
  const days = await checkStoredDays(new PrismaStoredDayCheckRepository(prisma));
  if ("error" in days) {
    console.error(days.error);
    process.exit(1);
  }
} catch (err) {
  console.error(`The server did not start: it could not read the stored days to check them (${(err as Error).message}).`);
  process.exit(1);
}

const config = loadConfig();

const app = await buildApp({ config });

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `Time zone where no device asks (MCP, API calls without X-Time-Zone, push notifications): ${describeFallbackZone(app.zones.fallback())}. The app's own "today" follows the device.`,
  );
  // The stored keys and the ChatGPT sign-in (#103): names and counts only,
  // never a value. Reading only; nothing is changed.
  const lines = await secretsReport(
    secretsBox(config.secretsKey),
    new PrismaAiSettingsRepository(prisma),
    new PrismaProviderCredentialRepository(prisma),
  ).catch(() => ["The stored AI keys could not be checked at start."]);
  for (const line of lines) console.warn(line);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
