import type { CadenceUnit, CommitmentLog, EbaEntry, EbaKind } from "@prisma/client";
import {
  deriveStatus,
  nextDueDate,
  periodHistory,
  type Cadence,
  type CommitmentStatus,
} from "../domain/cadence.js";
import type {
  PersonRepository,
  PersonWithRelations,
} from "../repositories/person-repository.js";
import type { CommitmentRepository } from "../repositories/commitment-repository.js";

export interface CreatePersonInput {
  name: string;
  relationship?: string | null;
  notes?: string | null;
}

export interface UpdatePersonInput {
  name?: string;
  relationship?: string | null;
  notes?: string | null;
}

export interface CreateCommitmentInput {
  title: string;
  description?: string | null;
  cadenceUnit: CadenceUnit;
  cadenceValue?: number;
  personIds: string[];
}

export interface UpdateCommitmentInput {
  title?: string;
  description?: string | null;
  cadenceUnit?: CadenceUnit;
  cadenceValue?: number;
  active?: boolean;
  personIds?: string[];
}

/** One person's view of one commitment — status and history are PER PERSON. */
export interface CommitmentView {
  id: string;
  title: string;
  cadenceUnit: CadenceUnit;
  cadenceValue: number;
  status: CommitmentStatus;
  lastOccurredAt: string | null;
  nextDueAt: string | null;
  /** Hit/miss for the last 8 cadence periods, oldest first. */
  history: boolean[];
}

/** The composed shape the People UI consumes. */
export interface PersonOverview {
  id: string;
  name: string;
  relationship: string | null;
  notes: string | null;
  /** Derived EBA balance: deposits − withdrawals. */
  balance: number;
  /** Most recent EBA entries (newest first). */
  ledger: { id: string; kind: EbaKind; note: string | null; occurredAt: string }[];
  commitments: CommitmentView[];
  createdAt: string;
  updatedAt: string;
}

const LEDGER_LIMIT = 10;
const HISTORY_PERIODS = 8;

function deriveOverview(person: PersonWithRelations, now: Date): PersonOverview {
  const deposits = person.ebaEntries.filter((e) => e.kind === "DEPOSIT").length;
  const balance = deposits - (person.ebaEntries.length - deposits);

  const commitments = person.commitments
    .filter(({ commitment }) => commitment.active)
    .map(({ commitment }) => {
      const cadence: Cadence = {
        unit: commitment.cadenceUnit,
        value: commitment.cadenceValue,
      };
      // Per-person tracking (the chosen default): only this person's logs count.
      const occurrences = commitment.logs
        .filter((log) => log.personId === person.id)
        .map((log) => log.occurredAt);
      const last = occurrences.length
        ? occurrences.reduce((a, b) => (a > b ? a : b))
        : null;
      return {
        id: commitment.id,
        title: commitment.title,
        cadenceUnit: commitment.cadenceUnit,
        cadenceValue: commitment.cadenceValue,
        status: deriveStatus(last, cadence, now),
        lastOccurredAt: last ? last.toISOString() : null,
        nextDueAt: last ? nextDueDate(last, cadence).toISOString() : null,
        history: periodHistory(occurrences, cadence, HISTORY_PERIODS, now),
      };
    });

  return {
    id: person.id,
    name: person.name,
    relationship: person.relationship,
    notes: person.notes,
    balance,
    ledger: person.ebaEntries.slice(0, LEDGER_LIMIT).map((e) => ({
      id: e.id,
      kind: e.kind,
      note: e.note,
      occurredAt: e.occurredAt.toISOString(),
    })),
    commitments,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  };
}

/**
 * Public Victory (Habits 4-6): people, their recurring commitments, and the
 * emotional bank account. Status, history, and balance are always DERIVED.
 */
export class PeopleService {
  constructor(
    private readonly people: PersonRepository,
    private readonly commitments: CommitmentRepository,
  ) {}

  // --- People ---------------------------------------------------------------

  async createPerson(input: CreatePersonInput): Promise<PersonOverview> {
    const person = await this.people.create({
      name: input.name,
      relationship: input.relationship ?? null,
      notes: input.notes ?? null,
    });
    return deriveOverview(person, new Date());
  }

  async getPerson(id: string): Promise<PersonOverview | null> {
    const person = await this.people.findById(id);
    return person ? deriveOverview(person, new Date()) : null;
  }

  /** Everyone, with derived balance and per-person commitment status/history. */
  async overview(now: Date = new Date()): Promise<PersonOverview[]> {
    return (await this.people.findMany()).map((p) => deriveOverview(p, now));
  }

  async updatePerson(id: string, input: UpdatePersonInput): Promise<PersonOverview> {
    const person = await this.people.update(id, input);
    return deriveOverview(person, new Date());
  }

  async removePerson(id: string): Promise<void> {
    await this.people.delete(id);
  }

  // --- Emotional bank account ------------------------------------------------

  addEbaEntry(
    personId: string,
    kind: EbaKind,
    note?: string | null,
    /** Chosen by the caller (an idempotent create, #109); left out = generated. */
    id?: string,
  ): Promise<EbaEntry> {
    return this.people.addEbaEntry({ ...(id ? { id } : {}), personId, kind, note: note ?? null });
  }

  getEbaEntry(id: string): Promise<EbaEntry | null> {
    return this.people.findEbaEntry(id);
  }

  /** Whether a commitment exists (for the operations' checks). */
  async hasCommitment(id: string): Promise<boolean> {
    return (await this.commitments.findById(id)) !== null;
  }

  getOccurrence(id: string): Promise<CommitmentLog | null> {
    return this.commitments.findLog(id);
  }

  // --- Commitments ------------------------------------------------------------

  async createCommitment(input: CreateCommitmentInput): Promise<string> {
    const commitment = await this.commitments.create({
      title: input.title,
      description: input.description ?? null,
      cadenceUnit: input.cadenceUnit,
      cadenceValue: input.cadenceValue ?? 1,
      participants: {
        create: input.personIds.map((personId) => ({ personId })),
      },
    });
    return commitment.id;
  }

  async updateCommitment(id: string, input: UpdateCommitmentInput): Promise<void> {
    const { personIds, ...fields } = input;
    if (Object.keys(fields).length > 0) {
      await this.commitments.update(id, fields);
    }
    if (personIds !== undefined) {
      await this.commitments.setParticipants(id, personIds);
    }
  }

  async removeCommitment(id: string): Promise<void> {
    await this.commitments.delete(id);
  }

  /** Log an occurrence — personId set = per-person tracking (the default). */
  async logOccurrence(
    commitmentId: string,
    opts: { id?: string; personId?: string | null; note?: string | null; occurredAt?: Date } = {},
  ): Promise<CommitmentLog> {
    return this.commitments.addLog({
      ...(opts.id ? { id: opts.id } : {}),
      commitmentId,
      personId: opts.personId ?? null,
      note: opts.note ?? null,
      ...(opts.occurredAt ? { occurredAt: opts.occurredAt } : {}),
    });
  }

  // --- Overdue query (the nudge surface) --------------------------------------

  async overdue(now: Date = new Date()): Promise<
    {
      personId: string;
      personName: string;
      commitmentId: string;
      title: string;
      lastOccurredAt: string | null;
    }[]
  > {
    const all = await this.overview(now);
    return all.flatMap((person) =>
      person.commitments
        .filter((c) => c.status === "OVERDUE")
        .map((c) => ({
          personId: person.id,
          personName: person.name,
          commitmentId: c.id,
          title: c.title,
          lastOccurredAt: c.lastOccurredAt,
        })),
    );
  }
}
