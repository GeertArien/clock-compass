-- CreateTable
CREATE TABLE "TaskSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cadenceUnit" TEXT NOT NULL,
    "cadenceValue" INTEGER NOT NULL DEFAULT 1,
    "from" TEXT NOT NULL DEFAULT 'SCHEDULE',
    "anchorDate" DATETIME NOT NULL,
    "leadDays" INTEGER,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "proactivity" TEXT,
    "isBigRock" BOOLEAN NOT NULL DEFAULT false,
    "plannedWeek" DATETIME,
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "scheduledDay" DATETIME,
    "scheduledTime" TEXT,
    "goalId" TEXT,
    "projectId" TEXT,
    "seriesId" TEXT,
    "previousId" TEXT,
    "slotDate" DATETIME,
    "showFrom" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "externalPriority" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TaskSeries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("completedAt", "createdAt", "dueDate", "externalId", "externalPriority", "goalId", "id", "important", "isBigRock", "notes", "plannedWeek", "proactivity", "projectId", "scheduledDay", "scheduledTime", "source", "status", "title", "updatedAt", "urgent") SELECT "completedAt", "createdAt", "dueDate", "externalId", "externalPriority", "goalId", "id", "important", "isBigRock", "notes", "plannedWeek", "proactivity", "projectId", "scheduledDay", "scheduledTime", "source", "status", "title", "updatedAt", "urgent" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_previousId_key" ON "Task"("previousId");
CREATE INDEX "Task_goalId_idx" ON "Task"("goalId");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_scheduledDay_idx" ON "Task"("scheduledDay");
CREATE INDEX "Task_seriesId_idx" ON "Task"("seriesId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
