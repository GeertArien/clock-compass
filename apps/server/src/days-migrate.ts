/**
 * Move stored days to plain dates (#112, #136).
 *
 * LEGACY (to remove in #137, once every stored day has moved).
 *
 *   days:migrate --from Europe/Brussels --dry-run   # report only
 *   days:migrate --from Europe/Brussels             # move, in one transaction
 *   days:migrate --from Europe/Brussels --from America/New_York
 *
 * `--from` is the zone the values were written in: for habit marks and weekly
 * intentions the zone the server ran in; for scheduled days the zone of the
 * device that scheduled them. Give it once per zone (tasks scheduled while
 * travelling); each value is read in the first zone where it is a midnight.
 * Scheduled days usually move by themselves at start-up (#136); this is the
 * path for the case the server refused. A second run changes nothing.
 */
import { PrismaDayRepository, describePlan, isTimeZone, planDayMigration, planWork, prisma } from "@clock-compass/core";

export interface MigrateArgs {
  from: string[];
  dryRun: boolean;
}

/** Reads `--from <zone>` (once or more) and `--dry-run`; a message instead when they are wrong. */
export function parseArgs(argv: readonly string[]): MigrateArgs | string {
  const from: string[] = [];
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--from") {
      const zone = argv[++i];
      if (!zone) return "--from needs a zone: --from Europe/Brussels.";
      if (!isTimeZone(zone)) return `--from: "${zone}" is not a time zone this runtime knows (use an IANA name such as Europe/Brussels).`;
      if (!from.includes(zone)) from.push(zone);
    } else if (arg !== "--dry-run") unknown.push(arg);
  }
  if (unknown.length) return `Unknown option: ${unknown.join(" ")}`;
  if (!from.length) return "Give the zone the days were written in: --from Europe/Brussels (once per zone; add --dry-run to only report).";
  return { from, dryRun: argv.includes("--dry-run") };
}

/** Plan, report, and (unless a dry run, or refused) apply. Returns the exit code. */
export async function migrateDays(
  repo: Pick<PrismaDayRepository, "findAll" | "apply">,
  args: MigrateArgs,
  print: (line: string) => void,
): Promise<number> {
  const plan = planDayMigration(await repo.findAll(), args.from);
  for (const line of describePlan(plan, args.from)) print(line);
  if (plan.refused.length) return 1;
  if (planWork(plan) === 0) {
    print("Nothing to move.");
    return 0;
  }
  if (args.dryRun) {
    print("Dry run: nothing was changed. Run again without --dry-run to move them.");
    return 0;
  }
  await repo.apply(plan);
  print("Done. Every stored day is now a plain date.");
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    process.exit(2);
  }
  try {
    process.exitCode = await migrateDays(new PrismaDayRepository(prisma), args, (line) => console.log(line));
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as a program, not when imported by the tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
