import type {
  ExportData,
  ExportRepository,
} from "../repositories/export-repository.js";

/** Stable marker so a future importer can recognise and version-check a file. */
export const EXPORT_FORMAT = "clock-compass-export" as const;
export const EXPORT_VERSION = 1 as const;

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  /** ISO timestamp the backup was taken. */
  exportedAt: string;
  data: ExportData;
}

/**
 * Assembles a full, portable JSON backup of the user's data (the mirror of the
 * Todoist CSV import). Read-only; secrets and device-bound rows are excluded at
 * the repository layer. A versioned envelope leaves room for a future restore.
 */
export class ExportService {
  constructor(private readonly repo: ExportRepository) {}

  async export(now: Date = new Date()): Promise<ExportBundle> {
    const data = await this.repo.dumpAll();
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      data,
    };
  }
}
