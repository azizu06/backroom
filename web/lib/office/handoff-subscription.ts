/** Narrow compatibility boundary until the shared generated #152 bindings land. No private rows. */
interface PublicHandoffTable {
  iter(): Iterable<unknown>;
  onInsert(changed: () => void): void;
  onUpdate(changed: () => void): void;
  onDelete(changed: () => void): void;
}
export function publicHandoffTable(db: object): PublicHandoffTable | undefined {
  return (db as { agentHandoffPublic?: PublicHandoffTable }).agentHandoffPublic;
}
