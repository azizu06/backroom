/** Shared wording for client fetch failures, so no page shows a raw "Unexpected token '<'" to a judge. */
export const NETWORK_MESSAGE = 'Backroom could not be reached. Check the connection and try again.';
export const outageMessage = (status: number) => `Backroom is not responding right now (HTTP ${status}). Try again in a moment.`;

/** A route's JSON object body, or undefined for HTML error pages, empty bodies, null, arrays and primitives. */
export async function jsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
  const parsed: unknown = await response.json().catch(() => undefined);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

/** The server's own string `error`, if it sent one. */
export function serverError(body: Record<string, unknown>): string | undefined {
  return typeof body.error === 'string' ? body.error : undefined;
}
