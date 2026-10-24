import type { HandoffRole } from './voices';
export type HandoffLine = { role: HandoffRole; text: string };
/** Browser-safe: use the office's authenticated controller transport/proxy.
 * The proxy attaches TOOL_GATEWAY_SECRET server-side; never embed it here.
 * Returns a WAV blob; office playback must follow the user's audio-enable gesture. */
export async function getHandoffAudio(line: HandoffLine, transport: typeof fetch = fetch): Promise<Blob> {
  const response = await transport('/api/handoff', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(line) });
  if (!response.ok) throw Error(`HANDOFF_AUDIO_HTTP_${response.status}`);
  return response.blob();
}
