/**
 * The stored-days check of #137 as a program of its own, for the container's
 * entrypoint: it runs BEFORE the database migrations, so a refused start
 * really changes nothing, and the version to pass through first meets a
 * schema it knows. The server runs the same check again when it starts (for
 * a start without the entrypoint).
 */
import { PrismaStoredDayCheckRepository, prisma } from "@clock-compass/core";
import { checkStoredDays } from "./stored-days.js";

try {
  const days = await checkStoredDays(new PrismaStoredDayCheckRepository(prisma));
  if ("error" in days) {
    console.error(days.error);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`The server did not start: it could not read the stored days to check them (${(err as Error).message}).`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
