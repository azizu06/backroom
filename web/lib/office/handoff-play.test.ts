import { describe, expect, it } from 'vitest';
import type { Handoff } from './handoffs';
import { HandoffStage } from './handoff-plan';
import { interactCandidates, pickTarget, playPanel, targetKey, targetLabel } from './play';
import { INITIAL_OFFICE } from './state';

const make = (id:string, from:'intake'|'extractor', to:'extractor'|'vendor', status:'accepted'|'rejected', at:number, summary:string):Handoff => ({handoffId:id,sequence:BigInt(at),caseDisplayId:'INV-1',fromAgentId:`${from}-agent`,toAgentId:`${to}-agent`,fromRole:from,toRole:to,fromVoiceRole:from,toVoiceRole:to,status,correction:false,reason:summary,summary,line:summary,createdAt:at});
const rows: Handoff[] = [make('h1','intake','extractor','accepted',0,'first'),make('h2','extractor','vendor','rejected',10,'bad account')];
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
    expect(latest).toMatchObject({ kind: 'handoff', title: 'Extractor · handoff', state: 'rejected', handoff: { from: 'Extractor', to: 'Vendor verifier', summary: 'bad account' } });
    expect(latest.entries.map(entry => entry.decision)).toEqual(['REJECTED', 'ACCEPTED']);
    const inFlight = playPanel(snapshot, { kind: 'handoff', actor: 'extractor' }, () => rows[0])!;
    expect(inFlight.handoff?.summary).toBe('first');
    const refreshed = playPanel(snapshot, { kind: 'handoff', actor: 'extractor' }, () => ({ ...rows[0]!, summary: 'Stale plan text' }))!;
    expect(refreshed.handoff?.summary).toBe('first');
    expect(playPanel(snapshot, { kind: 'handoff', actor: 'auditor' })).toBeNull();
  });
  it('orders by bigint sequence and limits the panel history to the current case', () => {
    const old = { ...rows[1]!, sequence: 9_007_199_254_740_992n, createdAt: 9999, caseDisplayId: 'OTHER' };
    const current = { ...rows[0]!, sequence: 9_007_199_254_740_993n, createdAt: 0, decisionRef: 'decision:42', correction: true };
    const panel = playPanel({ ...snapshot, handoffs: [current, old] }, { kind: 'handoff', actor: 'extractor' })!;
    expect(panel.handoff).toMatchObject({ correction: true, caseDisplayId: 'INV-1' });
    expect(panel.entries).toHaveLength(1);
    expect(panel.entries[0]!.summary).toContain(current.summary);
    expect(JSON.stringify(panel)).not.toContain(current.decisionRef);
  });
});
