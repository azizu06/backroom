import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_OFFICE, type OfficeAgent, type OfficeSnapshot } from './state';
import { SOUND_COOLDOWN_MS, SOUND_CUES, SOUND_PREFERENCE_KEY, cooldownFor, cuesFor, soundPreference, writeSoundPreference, type CueTimes } from './sound';
import { isOfficeCue, playOfficeCue } from './sound-events';

const snap = (patch: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, ...patch });
const audit = (id: string, decision: 'DENY' | 'ESCALATE') => ({ id, agentId: 'a', seatId: 'collections', action: 'x', decision, ruleIds: [], summary: '' });
const agent = (escalationId?: string): OfficeAgent => ({ id: 'a', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [0, 0], state: 'working', escalationId });

afterEach(() => vi.unstubAllGlobals());

describe('office sound cues', () => {
  it('detects denial and escalation cues from new snapshot rows', () => {
    expect(cuesFor(snap(), snap({ audit: [audit('d', 'DENY')] }), 1000)).toEqual(['deny']);
    expect(cuesFor(snap(), snap({ audit: [audit('e', 'ESCALATE')] }), 1000)).toEqual(['passkey']);
  });
  it('deduplicates audit rows, door denials and agents in the same diff', () => {
    const next = snap({
      audit: [audit('d', 'DENY'), audit('d2', 'DENY'), audit('e', 'ESCALATE')],
      denials: [{ room: 'treasury', agentId: 'a', auditId: 'd', at: 1 }], agents: [agent('e')],
    });
    const cues = cuesFor(snap(), next, 1000);
    expect(cues).toEqual(['deny', 'passkey']);
    expect(cues.length).toBeLessThanOrEqual(3);
    expect(cuesFor(next, next, 2000)).toEqual([]);
    expect(cuesFor(next, snap(), 2000)).toEqual([]);
  });
  it('ignores existing rows, reordering and unrelated snapshot changes', () => {
    const prev = snap({ audit: [audit('d', 'DENY'), audit('e', 'ESCALATE')] });
    expect(cuesFor(prev, { ...prev, audit: [...prev.audit].reverse(), inboxCount: 5, llmEnabled: true })).toEqual([]);
    expect(cuesFor(snap(), snap({ audit: [{ ...audit('a', 'DENY'), decision: 'ALLOW' }] }))).toEqual([]);
  });
  it('detects an agent gaining a new escalation without an audit row', () => {
    expect(cuesFor(snap({ agents: [agent()] }), snap({ agents: [agent('e')] }))).toEqual(['passkey']);
    expect(cuesFor(snap(), snap({ agents: [agent('e')] }))).toEqual(['passkey']);
    expect(cuesFor(snap({ agents: [agent('e')] }), snap({ agents: [agent('e2')] }))).toEqual(['passkey']);
    expect(cuesFor(snap({ agents: [agent('e')] }), snap({ agents: [agent('e')] }))).toEqual([]);
    expect(cuesFor(snap({ agents: [agent('e')] }), snap({ agents: [agent()] }))).toEqual([]);
  });
  it('rate limits each cue for 800ms and permits it again afterward', () => {
    const previous = { deny: 1000 };
    const next = snap({ denials: [{ room: 'treasury', agentId: 'a', auditId: 'd', at: 1 }] });
    expect(cuesFor(snap(), next, 1799, previous)).toEqual([]);
    expect(cuesFor(snap(), next, 1800, previous)).toEqual(['deny']);
  });
  it('uses the injected clock and independent cooldowns without mutating inputs', () => {
    let now = 0;
    const clock = () => now;
    const played: CueTimes = {};
    const prev = snap();
    const next = snap({ audit: [audit('d', 'DENY'), audit('e', 'ESCALATE')] });
    for (const kind of cuesFor(prev, next, clock(), played)) played[kind] = clock();
    now = 799;
    expect(cuesFor(prev, next, clock(), played)).toEqual([]);
    expect(cuesFor(prev, next, clock(), { deny: 0 })).toEqual(['passkey']);
    now = 800;
    expect(cuesFor(prev, next, clock(), played)).toEqual(['deny', 'passkey']);
    expect(played).toEqual({ deny: 0, passkey: 0 });
    expect(prev.audit).toEqual([]);
    expect(next.audit).toHaveLength(2);
  });
  it('catalogues only quiet synthesized cues and rejects invalid event kinds', () => {
    expect(Object.keys(SOUND_CUES)).toEqual(['roomTone', 'handoff', 'deny', 'passkey', 'interact', 'step', 'pingHit', 'pingBounce']);
    for (const [kind, cue] of Object.entries(SOUND_CUES)) {
      expect(cue.gain).toBeGreaterThan(0);
      expect(cue.gain).toBeLessThanOrEqual(0.1);
      expect(cue.frequencies.every(frequency => frequency > 0)).toBe(true);
      expect(cue.attackMs).toBeGreaterThan(0);
      expect(cue.releaseMs).toBeGreaterThan(0);
      expect(isOfficeCue(kind)).toBe(kind !== 'roomTone');
    }
    for (const kind of [null, undefined, {}, 'constructor', '__proto__', 'unknown']) expect(isOfficeCue(kind)).toBe(false);
    expect(() => playOfficeCue('interact')).not.toThrow(); // no window on the server
  });
  it('lets footsteps repeat several times a second while other cues keep the default cooldown', () => {
    expect(cooldownFor('step')).toBeLessThan(300);
    expect(cooldownFor('step')).toBeGreaterThan(0);
    for (const kind of ['handoff', 'deny', 'passkey', 'interact'] as const) expect(cooldownFor(kind)).toBe(SOUND_COOLDOWN_MS);
  });
  it('gives ping pong hits and bounces distinct short procedural cues', () => {
    expect(SOUND_CUES.pingHit.frequencies).not.toEqual(SOUND_CUES.pingBounce.frequencies);
    expect(cooldownFor('pingHit')).toBe(40);
    expect(cooldownFor('pingBounce')).toBe(40);
  });
  it('reads and writes preference safely', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(soundPreference(storage)).toBe('off');
    writeSoundPreference('on', storage);
    expect(soundPreference(storage)).toBe('on');
    expect(values.get(SOUND_PREFERENCE_KEY)).toBe('on');
    writeSoundPreference('off', storage);
    expect(soundPreference(storage)).toBe('off');
    values.set(SOUND_PREFERENCE_KEY, 'invalid');
    expect(soundPreference(storage)).toBe('off');
    expect(soundPreference({ getItem: () => { throw new Error('blocked'); } })).toBe('off');
    expect(() => writeSoundPreference('on', { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
  it('defaults off when storage is absent or access to it throws', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(soundPreference()).toBe('off');
    expect(() => writeSoundPreference('on')).not.toThrow();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(soundPreference()).toBe('off');
    expect(() => writeSoundPreference('off')).not.toThrow();
  });
});
