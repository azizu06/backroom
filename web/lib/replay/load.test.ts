import { expect, it } from 'vitest';
import { loadReplay } from './load';

it('loads the verified complete offline demo and rejects untrusted paths or missing recordings', async () => {
  const recording = await loadReplay('core-offline');
  expect(recording?.frames.length).toBeGreaterThan(100);
  expect(new Set(recording?.frames.map(frame => frame.phase)).size).toBe(4);
  expect(recording?.frames.flatMap(frame => frame.audit).some(row => row.ruleIds.includes('DUPLICATE_INVOICE'))).toBe(true);
  for (const name of ['../../.env.local', 'missing', '/etc/passwd', 'core-offline.jsonl']) expect(await loadReplay(name)).toBeUndefined();
});
