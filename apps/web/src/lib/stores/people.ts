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
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { Store } from "./store";
import { toast } from "./toast";

export { cadenceLabel } from "@clock-compass/web-client/meta";

interface PeopleState {
  people: PersonOverview[];
  loading: boolean;
  error: string | null;
}

/** The worst overdue commitment, for the single Clock · Today nudge (derived). */
export function worstOverdue(
  people: PersonOverview[],
): { personName: string; title: string } | null {
  for (const person of people) {
    const overdue = person.commitments.find((c) => c.status === "OVERDUE");
    if (overdue) return { personName: person.name, title: overdue.title };
  }
  return null;
}

/**
 * People + commitments + EBA (Habits 4–6). The overview is fully derived
 * server-side, so mutations reload it rather than patching locally.
 */
export class PeopleStore extends Store<PeopleState> {
  constructor() {
    super({ people: [], loading: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      this.setState({ people: await listPeople() });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load people") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Silent reload after mutations. */
  async #refresh(): Promise<void> {
    try {
      this.setState({ people: await listPeople() });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async #run(action: () => Promise<unknown>, success?: string): Promise<void> {
    try {
      await action();
      if (success) toast.success(success);
      await this.#refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  addPerson(body: { name: string; relationship?: string }): Promise<void> {
    return this.#run(() => createPerson(body), "Person added");
  }

  removePerson(id: string): Promise<void> {
    return this.#run(() => deletePerson(id), "Person removed");
  }

  addCommitment(body: {
    title: string;
    cadenceUnit: CadenceUnit;
    cadenceValue?: number;
    personIds: string[];
  }): Promise<void> {
    return this.#run(() => createCommitment(body), "Commitment added");
  }

  removeCommitment(id: string): Promise<void> {
    return this.#run(() => deleteCommitment(id), "Commitment removed");
  }

  log(commitmentId: string, personId: string, note?: string): Promise<void> {
    return this.#run(() => logOccurrence(commitmentId, { personId, note }), "Occurrence logged");
  }

  eba(personId: string, kind: EbaKind, note?: string): Promise<void> {
    return this.#run(() => addEbaEntry(personId, { kind, note }));
  }
}

export const peopleStore = new PeopleStore();
