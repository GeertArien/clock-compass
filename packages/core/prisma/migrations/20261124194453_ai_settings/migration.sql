-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKey" TEXT,
    "keyHint" TEXT,
    "models" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiJobSetting" (
    "job" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT,
    "model" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiJobSetting_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProviderConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiDataSwitch" (
    "category" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderConfig_name_key" ON "AiProviderConfig"("name");
