import { PrismaDayRepository, countNotPlain, describeFallbackZone, prisma } from "@clock-compass/core";
import { describeVersion, versionFromEnv } from "@clock-compass/core";
import { buildApp } from "./app.js";
import { loadConfig, retiredAiNotice } from "./config.js";
import { checkServerZone, runScheduledDayMove } from "./time-zone.js";

// The first line of the log names the running version (#140).
console.log(`Clock & Compass ${describeVersion(versionFromEnv())}`);

// `TZ` is an optional override (#136): refuse a zone Node would silently
// replace with UTC.
const tzCheck = checkServerZone();
if ("error" in tzCheck) {
  console.error(tzCheck.error);
  process.exit(1);
}

const config = loadConfig();

const app = await buildApp({ config });

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `Time zone where no device asks (MCP, API calls without X-Time-Zone, push notifications): ${describeFallbackZone(app.zones.fallback())}. The app's own "today" follows the device.`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// The AI environment variables are no longer read (#94): say so once.
const retired = retiredAiNotice();
if (retired) console.warn(retired);

const days = new PrismaDayRepository(prisma);

// LEGACY (#136, to remove in #137): old scheduled days (midnight on the
// device that scheduled them) move to plain dates by themselves, in the
// zones the server knows. Never fatal.
await runScheduledDayMove(days, app.zones.reported(), console);

// LEGACY (#112, to remove in #137): habit marks and intentions written by a
// server outside UTC are not plain dates yet: say so, with the command that
// moves them. Never fatal.
try {
  const pending = countNotPlain(await days.findAll());
  if (pending > 0) {
    console.warn(
      `${pending} stored habit marks or weekly intentions are not plain dates yet (written before this update by a server outside UTC). ` +
        "Run once: node apps/server/dist/days-migrate.js --from <the zone the server ran in> --dry-run, then again without --dry-run.",
    );
  }
} catch (err) {
  app.log.warn({ err }, "could not check the stored days");
}
