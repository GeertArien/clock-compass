import { PrismaDayRepository, countNotPlain, prisma } from "@clock-compass/core";
import { buildApp } from "./app.js";
import { loadConfig, retiredAiNotice } from "./config.js";
import { checkServerZone } from "./time-zone.js";

// The server's zone decides "today" where no device asks (#112): refuse a
// zone Node would silently replace with UTC.
const zone = checkServerZone();
if ("error" in zone) {
  console.error(zone.error);
  process.exit(1);
}

const config = loadConfig();

const app = await buildApp({ config });

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `Server time zone: ${zone.zone}. "Today" follows the device when the app sends X-Time-Zone; ${zone.zone} is used for MCP, API calls without it, and push notifications.`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// The AI environment variables are no longer read (#94): say so once.
const retired = retiredAiNotice();
if (retired) console.warn(retired);

// Days written before #112 by a server outside UTC are not plain dates yet:
// say so, with the command that moves them. Never fatal.
try {
  const pending = countNotPlain(await new PrismaDayRepository(prisma).findAll());
  if (pending > 0) {
    console.warn(
      `${pending} stored habit marks or weekly intentions are not plain dates yet (written before this update by a server outside UTC). ` +
        "Run once: node apps/server/dist/days-migrate.js --from <the zone the server ran in> --dry-run, then again without --dry-run.",
    );
  }
} catch (err) {
  app.log.warn({ err }, "could not check the stored days");
}
