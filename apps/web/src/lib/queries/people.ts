import { mutationOptions, queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
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
import { toast } from "@/lib/stores/toast";

export { cadenceLabel } from "@clock-compass/web-client/meta";

/**
 * People + commitments + EBA (Habits 4–6). The overview (statuses, balances,
 * streaks) is derived server-side, so writes reload it rather than patching.
 */
export const peopleQuery = queryOptions({
  queryKey: ["people"],
  queryFn: listPeople,
});

const NO_PEOPLE: PersonOverview[] = [];

/** The people, or none until they've loaded (a stable empty list). */
export function usePeople(): PersonOverview[] {
  return useQuery(peopleQuery).data ?? NO_PEOPLE;
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
 * The quiet reload after a write. A failure is a toast with the list kept
 * as it was, not the screen's load error (that banner is for loading).
 */
async function refreshPeople(client: QueryClient): Promise<void> {
  try {
    client.setQueryData(peopleQuery.queryKey, await listPeople());
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

/** A write to people: toast, then reload the derived overview. */
function peopleWrite<V>(name: string, write: (vars: V) => Promise<unknown>, success?: string) {
  return mutationOptions({
    mutationKey: ["people", name],
    mutationFn: write,
    onSuccess: async (_data: unknown, _vars: V, _ctx: unknown, { client }) => {
      if (success) toast.success(success);
      await refreshPeople(client);
    },
    onError: (err: Error) => toast.error(errorMessage(err)),
  });
}

export const addPerson = peopleWrite(
  "add",
  (body: { name: string; relationship?: string }) => createPerson(body),
  "Person added",
);

export const removePerson = peopleWrite("remove", (id: string) => deletePerson(id), "Person removed");

export const addCommitment = peopleWrite(
  "add-commitment",
  (body: { title: string; cadenceUnit: CadenceUnit; cadenceValue?: number; personIds: string[] }) =>
    createCommitment(body),
  "Commitment added",
);

export const removeCommitment = peopleWrite(
  "remove-commitment",
  (id: string) => deleteCommitment(id),
  "Commitment removed",
);

export const logCommitment = peopleWrite(
  "log",
  ({ commitmentId, personId, note }: { commitmentId: string; personId: string; note?: string }) =>
    logOccurrence(commitmentId, { personId, note }),
  "Occurrence logged",
);

export const addEba = peopleWrite(
  "eba",
  ({ personId, kind, note }: { personId: string; kind: EbaKind; note?: string }) =>
    addEbaEntry(personId, { kind, note }),
);
