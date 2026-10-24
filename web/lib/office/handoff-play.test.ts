import { describe, expect, it } from 'vitest';
import type { Handoff } from './handoffs';
import { HandoffStage } from './handoff-plan';
import { interactCandidates, pickTarget, playPanel, targetKey, targetLabel } from './play';
import { INITIAL_OFFICE } from './state';

const rows: Handoff[] = [
  { id: 'h1', from: 'intake', to: 'extractor', item: 'INV-1', summary: 'first', status: 'accepted', at: 0 },
  { id: 'h2', from: 'extractor', to: 'vendor_verifier', item: 'INV-1', summary: 'bad account', status: 'failed', at: 10 },
];
const snapshot = { ...INITIAL_OFFICE, handoffs: rows };

describe('Play handoff targets', () => {
  it('makes handoff agents pickable at their planned positions', () => {
    const stage = new HandoffStage();
    stage.update(rows);
    const extractor = stage.sample(0).actors.find(actor => actor.id === 'extractor')!;
    const eye: [number, number] = [extractor.position[0] + 1, extractor.position[1]];
    // Yaw π/2 looks toward -x.
    const target = pickTarget(eye, Math.PI / 2, interactCandidates([], [], [extractor]));
    expect(target).toEqual({ kind: 'handoff', actor: 'extractor' });
    expect(targetKey(target)).toBe('handoff:extractor');
    expect(targetLabel(snapshot, target!)).toBe('Ask Extractor about the handoff');
  });
  it('shows the in-flight handoff, falling back to the latest row for the agent', () => {
    const latest = playPanel(snapshot, { kind: 'handoff', actor: 'extractor' })!;
    expect(latest).toMatchObject({ kind: 'handoff', title: 'Extractor · handoff', state: 'failed', handoff: { id: 'h2', from: 'Extractor', to: 'Vendor verifier', summary: 'bad account' } });
    expect(latest.entries.map(entry => entry.decision)).toEqual(['FAILED', 'ACCEPTED']);
    const inFlight = playPanel(snapshot, { kind: 'handoff', actor: 'extractor' }, () => rows[0])!;
    expect(inFlight.handoff?.id).toBe('h1');
    expect(playPanel(snapshot, { kind: 'handoff', actor: 'auditor' })).toBeNull();
  });
});
