import { createSignInHTTP, hostOrigins, hostSignedIn, hostSignIn } from '../../../lib/operator/sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = createSignInHTTP({ signIn: hostSignIn, signedIn: hostSignedIn, origins: () => hostOrigins(process.env) });
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
