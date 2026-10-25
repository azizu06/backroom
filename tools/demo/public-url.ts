/** Preset public origin for demo:up. Empty means the quick-tunnel default. */
export function configuredPublicOrigin(raw: string | undefined): string {
  if (!raw) return '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('DEMO_PUBLIC_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('DEMO_PUBLIC_URL_INVALID');
  }
  return url.origin;
}

/** DEMO_TUNNEL=0 stays on localhost. A valid preset origin is used as-is and does not start cloudflared. */
export function demoPublicTarget(
  env: { DEMO_TUNNEL?: string; DEMO_PUBLIC_URL?: string },
  port: number,
  base: string,
): { publicUrl: string; startCloudflared: boolean } {
  const configured = configuredPublicOrigin(env.DEMO_PUBLIC_URL);
  const tunnelOff = env.DEMO_TUNNEL === '0';
  return {
    publicUrl: tunnelOff ? `http://localhost:${port}` : configured || base,
    startCloudflared: !tunnelOff && !configured,
  };
}
