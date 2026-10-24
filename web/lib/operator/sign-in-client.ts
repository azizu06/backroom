import { jsonObject, NETWORK_MESSAGE, outageMessage } from '../http/response';

/** Browser side of the one operator sign-in (`/api/session`); every operator page uses it. */
export const SIGN_IN_ENDPOINT = '/api/session';

/** Resolves with the server's message once this browser holds the session; throws a readable message otherwise. */
export async function signInOperator(code: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(SIGN_IN_ENDPOINT, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  } catch { throw new Error(NETWORK_MESSAGE); }
  const body = await jsonObject(response);
  if (!body) throw new Error(outageMessage(response.status));
  const message = typeof body.message === 'string' ? body.message : response.ok ? 'Signed in.' : 'Sign-in failed. Try again.';
  if (!response.ok) throw new Error(message);
  return message;
}
export async function operatorSessionActive(): Promise<boolean> {
  try {
    const body = await jsonObject(await fetch(SIGN_IN_ENDPOINT, { cache: 'no-store' }));
    return body?.signedIn === true;
  } catch { return false; }
}
export async function signOutOperator() {
  await fetch(SIGN_IN_ENDPOINT, { method: 'DELETE', cache: 'no-store' }).catch(() => undefined);
}
