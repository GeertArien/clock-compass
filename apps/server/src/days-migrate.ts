/**
 * Move stored habit marks and weekly intentions to plain dates (#112).
 *
 *   days:migrate --from Europe/Brussels --dry-run   # report only
 *   days:migrate --from Europe/Brussels             # move, in one transaction
 *
 * `--from` is the zone the server ran in while it wrote them. A deployment
 * that always ran in UTC (the documented Docker setup) has nothing to move.
 * Run it on purpose, once; a second run changes nothing.
 */
import { PrismaDayRepository, describePlan, isTimeZone, planDayMigration, prisma } from "@clock-compass/core";

export interface MigrateArgs {
  from: string;
  dryRun: boolean;
}

/** Reads `--from <zone>` and `--dry-run`; a message instead when they are wrong. */
export function parseArgs(argv: readonly string[]): MigrateArgs | string {
  const at = argv.indexOf("--from");
  const from = at >= 0 ? argv[at + 1] : undefined;
  if (!from) return "Give the zone the server ran in: --from Europe/Brussels (add --dry-run to only report).";
  if (!isTimeZone(from)) return `--from: "${from}" is not a time zone this runtime knows (use an IANA name such as Europe/Brussels).`;
  const unknown = argv.filter((a, i) => a.startsWith("--") && a !== "--from" && a !== "--dry-run" && argv[i - 1] !== "--from");
  if (unknown.length) return `Unknown option: ${unknown.join(" ")}`;
  return { from, dryRun: argv.includes("--dry-run") };
}

/** Plan, report, and (unless a dry run, or refused) apply. Returns the exit code. */
export async function migrateDays(
  repo: PrismaDayRepository,
  args: MigrateArgs,
  print: (line: string) => void,
): Promise<number> {
  const plan = planDayMigration(await repo.findAll(), args.from);
  for (const line of describePlan(plan, args.from)) print(line);
  if (plan.refused.length) return 1;
  const work = plan.marks.length + plan.intentions.length + plan.deleteMarks.length + plan.deleteIntentions.length;
  if (work === 0) {
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
