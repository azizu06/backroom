/** Browser-safe response contract; no runtime import from the server provider module. */
export interface AskWhyVoiceResult {
  question: string;
  answer: string;
  citations: string[];
  source: 'model' | 'fallback' | 'ungrounded';
  audio: { mimeType: 'audio/wav'; base64: string } | null;
  audioError: string | null;
  latencyMs: number;
}
