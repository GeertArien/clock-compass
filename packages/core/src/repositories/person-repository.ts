import type {
  Commitment,
  CommitmentLog,
  EbaEntry,
  Person,
  Prisma,
  PrismaClient,
} from "@prisma/client";

/** A person with everything the overview derives from: EBA + commitments + logs. */
export type PersonWithRelations = Person & {
  ebaEntries: EbaEntry[];
  commitments: { commitment: Commitment & { logs: CommitmentLog[] } }[];
};

/** The only place Prisma is touched for people and their EBA entries. */
export interface PersonRepository {
  create(data: Prisma.PersonCreateInput): Promise<PersonWithRelations>;
  findById(id: string): Promise<PersonWithRelations | null>;
  findMany(): Promise<PersonWithRelations[]>;
  update(id: string, data: Prisma.PersonUpdateInput): Promise<PersonWithRelations>;
  delete(id: string): Promise<void>;
  addEbaEntry(data: Prisma.EbaEntryUncheckedCreateInput): Promise<EbaEntry>;
  findEbaEntry(id: string): Promise<EbaEntry | null>;
}

const withRelations = {
  ebaEntries: { orderBy: { occurredAt: "desc" as const } },
  commitments: {
    include: {
      commitment: {
        include: { logs: { orderBy: { occurredAt: "desc" as const } } },
      },
    },
  },
} satisfies Prisma.PersonInclude;

export class PrismaPersonRepository implements PersonRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.PersonCreateInput): Promise<PersonWithRelations> {
    return this.db.person.create({ data, include: withRelations });
  }

  findById(id: string): Promise<PersonWithRelations | null> {
    return this.db.person.findUnique({ where: { id }, include: withRelations });
  }

  findMany(): Promise<PersonWithRelations[]> {
    return this.db.person.findMany({
      include: withRelations,
      orderBy: { createdAt: "asc" },
    });
  }

  update(id: string, data: Prisma.PersonUpdateInput): Promise<PersonWithRelations> {
    return this.db.person.update({ where: { id }, data, include: withRelations });
  }

  async delete(id: string): Promise<void> {
    // EBA entries cascade; commitment logs keep the commitment but null the person.
    await this.db.person.delete({ where: { id } });
  }

  addEbaEntry(data: Prisma.EbaEntryUncheckedCreateInput): Promise<EbaEntry> {
    return this.db.ebaEntry.create({ data });
  }

  findEbaEntry(id: string): Promise<EbaEntry | null> {
    return this.db.ebaEntry.findUnique({ where: { id } });
  }
}
