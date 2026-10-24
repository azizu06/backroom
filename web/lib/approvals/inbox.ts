// Escalation ids raised for the controller in this server process, oldest first.
// Rows stay in the StateStore; /api/controller/inbox reads them back through the service.
const key = Symbol.for('backroom.controller-inbox');
const root = globalThis as typeof globalThis & { [key]?: string[] };
const ids = root[key] ??= [];

export function noteEscalation(id: string) {
  const at = ids.indexOf(id);
  if (at >= 0) ids.splice(at, 1);
  ids.push(id);
  if (ids.length > 50) ids.shift();
}
export const inboxIds = (): readonly string[] => [...ids];
