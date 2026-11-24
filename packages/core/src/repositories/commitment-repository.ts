import type {
  Commitment,
  CommitmentLog,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type CommitmentWithParticipants = Commitment & {
  participants: { personId: string }[];
};

/** The only place Prisma is touched for commitments and their occurrence logs. */
export interface CommitmentRepository {
  create(
    data: Prisma.CommitmentCreateInput,
  ): Promise<CommitmentWithParticipants>;
  findById(id: string): Promise<CommitmentWithParticipants | null>;
  update(
    id: string,
    data: Prisma.CommitmentUpdateInput,
  ): Promise<CommitmentWithParticipants>;
  delete(id: string): Promise<void>;
  addLog(data: Prisma.CommitmentLogUncheckedCreateInput): Promise<CommitmentLog>;
  findLog(id: string): Promise<CommitmentLog | null>;
  setParticipants(id: string, personIds: string[]): Promise<void>;
}

const withParticipants = {
  participants: { select: { personId: true } },
} satisfies Prisma.CommitmentInclude;

export class PrismaCommitmentRepository implements CommitmentRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.CommitmentCreateInput): Promise<CommitmentWithParticipants> {
    return this.db.commitment.create({ data, include: withParticipants });
  }

  findById(id: string): Promise<CommitmentWithParticipants | null> {
    return this.db.commitment.findUnique({ where: { id }, include: withParticipants });
  }

  update(
    id: string,
    data: Prisma.CommitmentUpdateInput,
  ): Promise<CommitmentWithParticipants> {
    return this.db.commitment.update({ where: { id }, data, include: withParticipants });
  }

  async delete(id: string): Promise<void> {
    await this.db.commitment.delete({ where: { id } });
  }

  addLog(data: Prisma.CommitmentLogUncheckedCreateInput): Promise<CommitmentLog> {
    return this.db.commitmentLog.create({ data });
  }

  findLog(id: string): Promise<CommitmentLog | null> {
    return this.db.commitmentLog.findUnique({ where: { id } });
  }

  async setParticipants(id: string, personIds: string[]): Promise<void> {
    await this.db.$transaction([
      this.db.commitmentParticipant.deleteMany({ where: { commitmentId: id } }),
      this.db.commitmentParticipant.createMany({
        data: personIds.map((personId) => ({ commitmentId: id, personId })),
      }),
    ]);
  }
}
