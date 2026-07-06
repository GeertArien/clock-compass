import type {
  PrismaClient,
  MissionStatement,
  Role,
  Goal,
  Project,
  Task,
  Person,
  EbaEntry,
  Commitment,
  CommitmentParticipant,
  CommitmentLog,
  Habit,
  HabitMark,
  WeeklyIntention,
  RenewalActivity,
} from "@prisma/client";

/**
 * Every domain row that belongs in a logical backup. DELIBERATELY excludes:
 *   - ApiKey               — secret material (a hash); never export.
 *   - PushSubscription     — device-bound endpoint secrets, not portable.
 *   - NotificationSettings — device/runtime preferences, not user data.
 * Adding a new core model? Add it here so it makes it into backups.
 */
export interface ExportData {
  missionStatements: MissionStatement[];
  roles: Role[];
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  people: Person[];
  ebaEntries: EbaEntry[];
  commitments: Commitment[];
  commitmentParticipants: CommitmentParticipant[];
  commitmentLogs: CommitmentLog[];
  habits: Habit[];
  habitMarks: HabitMark[];
  weeklyIntentions: WeeklyIntention[];
  renewalActivities: RenewalActivity[];
}

/**
 * The repository is the ONLY place that talks to Prisma for the export — the
 * ExportService and the route handler stay ORM-free, keeping the SQLite->Postgres
 * swap clean. A single read of all backed-up tables.
 */
export interface ExportRepository {
  dumpAll(): Promise<ExportData>;
}

export class PrismaExportRepository implements ExportRepository {
  constructor(private readonly db: PrismaClient) {}

  async dumpAll(): Promise<ExportData> {
    const [
      missionStatements,
      roles,
      goals,
      projects,
      tasks,
      people,
      ebaEntries,
      commitments,
      commitmentParticipants,
      commitmentLogs,
      habits,
      habitMarks,
      weeklyIntentions,
      renewalActivities,
    ] = await Promise.all([
      this.db.missionStatement.findMany(),
      this.db.role.findMany(),
      this.db.goal.findMany(),
      this.db.project.findMany(),
      this.db.task.findMany(),
      this.db.person.findMany(),
      this.db.ebaEntry.findMany(),
      this.db.commitment.findMany(),
      this.db.commitmentParticipant.findMany(),
      this.db.commitmentLog.findMany(),
      this.db.habit.findMany(),
      this.db.habitMark.findMany(),
      this.db.weeklyIntention.findMany(),
      this.db.renewalActivity.findMany(),
    ]);

    return {
      missionStatements,
      roles,
      goals,
      projects,
      tasks,
      people,
      ebaEntries,
      commitments,
      commitmentParticipants,
      commitmentLogs,
      habits,
      habitMarks,
      weeklyIntentions,
      renewalActivities,
    };
  }
}
