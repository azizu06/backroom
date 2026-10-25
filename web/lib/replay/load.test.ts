import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { loadReplay } from './load';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('loads the verified complete offline demo and rejects untrusted paths or missing recordings', async () => {
  const recording = await loadReplay('core-offline');
  expect(recording?.frames.length).toBeGreaterThan(100);
  expect(new Set(recording?.frames.map(frame => frame.phase)).size).toBe(4);
  expect(recording?.frames.flatMap(frame => frame.audit).some(row => row.ruleIds.includes('DUPLICATE_INVOICE'))).toBe(true);
  for (const name of ['../../.env.local', 'missing', '/etc/passwd', 'core-offline.jsonl']) expect(await loadReplay(name)).toBeUndefined();
});

it.each([['repo root (demo host)', repoRoot], ['web/ (next dev)', join(repoRoot, 'web')]])('finds the recording when cwd is the %s', async (_, cwd) => {
  vi.stubEnv('BACKROOM_ROOT', '');
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  expect((await loadReplay('core-offline'))?.header.name).toBe('core-offline');
});

it('logs a missing recording apart from an invalid one, without leaking either to the caller', async () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-root-'));
  try {
    mkdirSync(join(root, 'orchestrator')); writeFileSync(join(root, 'orchestrator/package.json'), '{}');
    mkdirSync(join(root, 'fixtures/replays'), { recursive: true });
    const good = readFileSync(join(repoRoot, 'fixtures/replays/core-offline.jsonl'), 'utf8');
    writeFileSync(join(root, 'fixtures/replays/tampered.jsonl'), good.replace('DUPLICATE_INVOICE', 'DUPLICATE_INVOICX'));
    writeFileSync(join(root, 'fixtures/replays/renamed.jsonl'), good);
    vi.stubEnv('BACKROOM_ROOT', root);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadReplay('absent')).toBeUndefined();
    expect(await loadReplay('tampered')).toBeUndefined();
    expect(await loadReplay('renamed')).toBeUndefined();
    expect(warn.mock.calls.map(([line]) => String(line).split(' ').slice(0, 2).join(' ')))
      .toEqual(['REPLAY_MISSING absent', 'REPLAY_INVALID tampered', 'REPLAY_INVALID renamed']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
