import {
  addEbaEntry,
  createCommitment,
  createPerson,
  deleteCommitment,
  deletePerson,
  listPeople,
  logOccurrence,
  type CadenceUnit,
  type EbaKind,
  type PersonOverview,
} from "@/lib/api";
import { toast } from "@/lib/components/ui/toast";

function message(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * People + commitments + EBA (Habits 4–6). The overview is fully derived
 * server-side, so mutations simply reload it rather than patching locally.
 */
class PeopleStore {
  people = $state<PersonOverview[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.people = await listPeople();
    } catch (err) {
      this.error = message(err, "Failed to load people");
    } finally {
      this.loading = false;
    }
  }

  /** Silent reload after mutations. */
  private async refresh(): Promise<void> {
    try {
      this.people = await listPeople();
    } catch (err) {
      toast.error(message(err));
    }
  }

  /** The worst overdue commitment, for the single Clock · Today nudge. */
  get worstOverdue(): { personName: string; title: string } | null {
    for (const person of this.people) {
      const overdue = person.commitments.find((c) => c.status === "OVERDUE");
      if (overdue) return { personName: person.name, title: overdue.title };
    }
    return null;
  }

  async addPerson(body: { name: string; relationship?: string }): Promise<void> {
    try {
      await createPerson(body);
      toast.success("Person added");
      await this.refresh();
    } catch (err) {
      toast.error(message(err));
    }
  }

  async removePerson(id: string): Promise<void> {
    try {
      await deletePerson(id);
      toast.success("Person removed");
      await this.refresh();
    } catch (err) {
      toast.error(message(err));
    }
  }

  async addCommitment(body: {
    title: string;
    cadenceUnit: CadenceUnit;
    cadenceValue?: number;
    personIds: string[];
  }): Promise<void> {
    try {
      await createCommitment(body);
      toast.success("Commitment added");
      await this.refresh();
    } catch (err) {
      toast.error(message(err));
    }
  }

  async removeCommitment(id: string): Promise<void> {
    try {
      await deleteCommitment(id);
      toast.success("Commitment removed");
      await this.refresh();
    } catch (err) {
      toast.error(message(err));
    }
  }

  async log(commitmentId: string, personId: string, note?: string): Promise<void> {
    try {
      await logOccurrence(commitmentId, { personId, note });
      toast.success("Occurrence logged");
      await this.refresh();
    } catch (err) {
      toast.error(message(err));
    }
  }

  async eba(personId: string, kind: EbaKind, note?: string): Promise<void> {
    try {
      await addEbaEntry(personId, { kind, note });
      await this.refresh();
    } catch (err) {
      toast.error(message(err));
    }
  }
}

// Shared with the React app (issue #64): one definition in @clock-compass/web-client.
export { cadenceLabel } from "@clock-compass/web-client/meta";

export const peopleStore = new PeopleStore();
