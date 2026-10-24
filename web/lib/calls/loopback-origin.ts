/** This host's office, `http://127.0.0.1:<DEMO_PORT>`. Same declaration the dial route uses. */
export function declaredLoopbackOfficeOrigin(port = process.env.DEMO_PORT): string | undefined {
  const value = port || '3000';
  return /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 65535 ? `http://127.0.0.1:${Number(value)}` : undefined;
}
