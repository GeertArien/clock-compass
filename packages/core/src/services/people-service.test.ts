import { beforeEach, describe, expect, it } from "vitest";
import type {
  Commitment,
  CommitmentLog,
  EbaEntry,
  Prisma,
} from "@prisma/client";
import type {
  PersonRepository,
  PersonWithRelations,
} from "../repositories/person-repository.js";
import type {
  CommitmentRepository,
  CommitmentWithParticipants,
} from "../repositories/commitment-repository.js";
import { PeopleService } from "./people-service.js";

/**
 * A pair of in-memory fakes that share state, so the person overview can see
 * commitments/logs created through the commitment side.
 */
class FakeStore {
  people = new Map<string, PersonWithRelations>();
  commitments = new Map<string, Commitment & { participants: { personId: string }[]; logs: CommitmentLog[] }>();
  seq = 0;

  /** Rebuild a person's relations from shared state (what Prisma's include does). */
  hydrate(person: PersonWithRelations): PersonWithRelations {
    const commitments = [...this.commitments.values()]
      .filter((c) => c.participants.some((p) => p.personId === person.id))
      .map((commitment) => ({ commitment }));
    return { ...person, commitments };
  }
}

class FakePersonRepository implements PersonRepository {
  constructor(private readonly store: FakeStore) {}

  async create(data: Prisma.PersonCreateInput): Promise<PersonWithRelations> {
    const id = `person_${++this.store.seq}`;
    const now = new Date();
    const person: PersonWithRelations = {
      id,
      name: data.name,
      relationship: (data.relationship as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      ebaEntries: [],
      commitments: [],
    };
    this.store.people.set(id, person);
    return person;
  }

  async findById(id: string): Promise<PersonWithRelations | null> {
    const person = this.store.people.get(id);
    return person ? this.store.hydrate(person) : null;
  }

  async findMany(): Promise<PersonWithRelations[]> {
    return [...this.store.people.values()].map((p) => this.store.hydrate(p));
  }

  async update(id: string, data: Prisma.PersonUpdateInput): Promise<PersonWithRelations> {
    const existing = this.store.people.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...data } as PersonWithRelations;
    this.store.people.set(id, updated);
    return this.store.hydrate(updated);
  }

  async delete(id: string): Promise<void> {
    this.store.people.delete(id);
  }

  async addEbaEntry(data: Prisma.EbaEntryUncheckedCreateInput): Promise<EbaEntry> {
    const entry: EbaEntry = {
      id: (data.id as string | undefined) ?? `eba_${++this.store.seq}`,
      personId: data.personId,
      kind: data.kind,
      note: (data.note as string | null) ?? null,
      occurredAt: (data.occurredAt as Date | undefined) ?? new Date(),
      createdAt: new Date(),
    };
    this.store.people.get(data.personId)?.ebaEntries.unshift(entry);
    return entry;
  }

  async findEbaEntry(id: string): Promise<EbaEntry | null> {
    for (const p of this.store.people.values()) {
      const found = p.ebaEntries.find((e) => e.id === id);
      if (found) return found;
    }
    return null;
  }
}

class FakeCommitmentRepository implements CommitmentRepository {
  constructor(private readonly store: FakeStore) {}

  async create(data: Prisma.CommitmentCreateInput): Promise<CommitmentWithParticipants> {
    const id = `commitment_${++this.store.seq}`;
    const now = new Date();
    const participantCreate = data.participants?.create;
    const participants = (Array.isArray(participantCreate)
      ? participantCreate
      : participantCreate
        ? [participantCreate]
        : []
    ).map((p) => ({ personId: (p as { personId: string }).personId }));
    const commitment = {
      id,
      title: data.title,
      description: (data.description as string | null) ?? null,
      cadenceUnit: data.cadenceUnit,
      cadenceValue: (data.cadenceValue as number | undefined) ?? 1,
      active: true,
      createdAt: now,
      updatedAt: now,
      participants,
      logs: [] as CommitmentLog[],
    };
    this.store.commitments.set(id, commitment);
    return commitment;
  }

  async findById(id: string): Promise<CommitmentWithParticipants | null> {
    return this.store.commitments.get(id) ?? null;
  }

  async update(
    id: string,
    data: Prisma.CommitmentUpdateInput,
  ): Promise<CommitmentWithParticipants> {
    const existing = this.store.commitments.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...data } as typeof existing;
    this.store.commitments.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.commitments.delete(id);
  }

  async addLog(data: Prisma.CommitmentLogUncheckedCreateInput): Promise<CommitmentLog> {
    const log: CommitmentLog = {
      id: (data.id as string | undefined) ?? `log_${++this.store.seq}`,
      commitmentId: data.commitmentId,
      personId: (data.personId as string | null) ?? null,
      occurredAt: (data.occurredAt as Date | undefined) ?? new Date(),
      note: (data.note as string | null) ?? null,
      createdAt: new Date(),
    };
    this.store.commitments.get(data.commitmentId)?.logs.unshift(log);
    return log;
  }

  async findLog(id: string): Promise<CommitmentLog | null> {
    for (const c of this.store.commitments.values()) {
      const found = c.logs.find((l) => l.id === id);
      if (found) return found;
    }
    return null;
  }

  async setParticipants(id: string, personIds: string[]): Promise<void> {
    const commitment = this.store.commitments.get(id);
    if (commitment) commitment.participants = personIds.map((personId) => ({ personId }));
  }
}

describe("PeopleService", () => {
  let service: PeopleService;
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    service = new PeopleService(
      new FakePersonRepository(store),
      new FakeCommitmentRepository(store),
    );
  });

  it("derives the EBA balance from deposits and withdrawals", async () => {
    const person = await service.createPerson({ name: "Noor", relationship: "kid" });
    await service.addEbaEntry(person.id, "DEPOSIT", "Helped with homework");
    await service.addEbaEntry(person.id, "DEPOSIT");
    await service.addEbaEntry(person.id, "WITHDRAWAL", "Cancelled the cinema plan");
    const fetched = await service.getPerson(person.id);
    expect(fetched?.balance).toBe(1);
    expect(fetched?.ledger).toHaveLength(3);
  });

  it("tracks commitment status PER PERSON", async () => {
    const noor = await service.createPerson({ name: "Noor" });
    const finn = await service.createPerson({ name: "Finn" });
    const commitmentId = await service.createCommitment({
      title: "One-on-one",
      cadenceUnit: "WEEK",
      cadenceValue: 1,
      personIds: [noor.id, finn.id],
    });
    // Only Noor's occurrence is logged.
    await service.logOccurrence(commitmentId, { personId: noor.id });

    const overview = await service.overview();
    const noorView = overview.find((p) => p.id === noor.id)!.commitments[0]!;
    const finnView = overview.find((p) => p.id === finn.id)!.commitments[0]!;
    expect(noorView.status).toBe("ON_TRACK");
    expect(noorView.history.at(-1)).toBe(true);
    expect(finnView.status).toBe("OVERDUE");
    expect(finnView.lastOccurredAt).toBeNull();
  });

  it("lists overdue commitments per person", async () => {
    const dad = await service.createPerson({ name: "Dad", relationship: "parent" });
    await service.createCommitment({
      title: "Phone call",
      cadenceUnit: "WEEK",
      personIds: [dad.id],
    });
    const overdue = await service.overdue();
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ personName: "Dad", title: "Phone call" });
  });

  it("updates commitment participants", async () => {
    const a = await service.createPerson({ name: "A" });
    const b = await service.createPerson({ name: "B" });
    const id = await service.createCommitment({
      title: "Coffee",
      cadenceUnit: "MONTH",
      personIds: [a.id],
    });
    await service.updateCommitment(id, { personIds: [b.id] });
    const overview = await service.overview();
    expect(overview.find((p) => p.id === a.id)?.commitments).toHaveLength(0);
    expect(overview.find((p) => p.id === b.id)?.commitments).toHaveLength(1);
  });
});
