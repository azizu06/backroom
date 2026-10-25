import { describe, expect, it } from 'vitest';
import type { AgentHandoffPublic } from '@backroom/orchestrator/spacetime-client/types';
import { projectOfficeRows, type OfficeRows } from './spacetime';
import { HANDOFF_AGENTS, handoffSpot } from './handoffs';
import { HandoffStage } from './handoff-plan';
import { agentChatSource, agentChatTimeline } from './agent-chat';

/** A subscribed `agent_handoff_public` row, in the generated client's shape (docs/agents.md "Office projection contract"). */
function publicRow(extra: Partial<AgentHandoffPublic> = {}): AgentHandoffPublic {
  return {
    handoffId: 'case-1042:a1:h1', sequence: 7n, caseDisplayId: 'INV-1042', fromAgentId: 'intake-agent', toAgentId: 'payables-agent',
    fromRole: 'intake', toRole: 'payables', fromVoiceRole: 'intake_sorter', toVoiceRole: 'payables_clerk', status: 'offered',
    correction: false, reason: 'Invoice sorted', summary: 'Invoice fields ready for payment review', line: 'Passing INV-1042 to Payables.',
    createdAt: 10_000, acceptedAt: undefined, completedAt: undefined, decisionRef: undefined, errorCode: undefined, ...extra,
  };
}
function liveRows(handoffs: AgentHandoffPublic[]): OfficeRows {
  return { agents: [], rooms: [], seats: [], badges: [], escalations: [], audit: [], control: [], handoffs };
}
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

describe('live handoffs drive the office floor', () => {
  it('a subscribed offered row walks the from-agent toward the to-agent desk and holds the folder there', () => {
    const snapshot = projectOfficeRows(liveRows([publicRow()]));
    expect(snapshot.connection).toBe('live');
    expect(snapshot.handoffs).toHaveLength(1);
    const stage = new HandoffStage();
    stage.update(snapshot.handoffs!, 10_000);
    const trip = stage.plan.trips[0]!;
    const intake = (now: number) => stage.sample(now).actors.find(actor => actor.id === 'intake')!;
    const target = handoffSpot('payables');

    expect(intake(trip.start).position).toEqual(HANDOFF_AGENTS.intake.station);
    const halfway = intake((trip.start + trip.arrive) / 2);
    expect(halfway.moving).toBe(true);
    expect(distance(halfway.position, target)).toBeLessThan(distance(HANDOFF_AGENTS.intake.station, target));
    // Offered and not yet accepted: the sender waits at the receiver's desk with the folder.
    expect(intake(trip.arrive + 60_000).position).toEqual(target);
    expect(stage.sample(trip.arrive + 60_000).folders[0]).toMatchObject({ carrier: 'intake' });
  });

  it('the accepted row on the next refresh hands the folder over and the sender walks home', () => {
    const stage = new HandoffStage();
    stage.update(projectOfficeRows(liveRows([publicRow()])).handoffs!, 10_000);
    const arrive = stage.plan.trips[0]!.arrive;
    stage.update(projectOfficeRows(liveRows([publicRow({ status: 'completed', acceptedAt: arrive + 500, completedAt: arrive + 4_000 })])).handoffs!, arrive + 500);
    const trip = stage.plan.trips[0]!;
    expect(stage.sample(trip.end + 1).actors.find(actor => actor.id === 'intake')!.position).toEqual(HANDOFF_AGENTS.intake.station);
  });

  it('a live call escalation walks Collections to Dana while pending and home once Dana decides', () => {
    const escalation = (extra: Partial<AgentHandoffPublic>) => publicRow({ handoffId: 'call-1:esc', fromAgentId: 'voice:collections', toAgentId: 'human:Dana',
      fromRole: 'collections', toRole: 'human', fromVoiceRole: 'collections_caller', toVoiceRole: 'human', ...extra });
    const stage = new HandoffStage();
    stage.update(projectOfficeRows(liveRows([escalation({ status: 'offered' })])).handoffs!, 10_000);
    const trip = stage.plan.trips[0]!;
    const collections = (now: number) => stage.sample(now).actors.find(actor => actor.id === 'collections')!;
    expect(collections(trip.start).position).toEqual(HANDOFF_AGENTS.collections.station);
    const halfway = collections((trip.start + trip.arrive) / 2).position;
    expect(distance(halfway, handoffSpot('human'))).toBeLessThan(distance(HANDOFF_AGENTS.collections.station, handoffSpot('human')));
    expect(collections(trip.arrive + 120_000).position).toEqual(handoffSpot('human'));
    const decided = trip.arrive + 2_000;
    stage.update(projectOfficeRows(liveRows([escalation({ status: 'completed', acceptedAt: decided, completedAt: decided + 100 })])).handoffs!, decided);
    expect(collections(stage.plan.trips[0]!.end + 1).position).toEqual(HANDOFF_AGENTS.collections.station);
  });

  it('the after-call chain walks Reconciler to the Auditor desk', () => {
    const stage = new HandoffStage();
    stage.update(projectOfficeRows(liveRows([publicRow({ handoffId: 'call-1:recon', fromAgentId: 'reconciler-agent', toAgentId: 'auditor-agent',
      fromRole: 'reconciler', toRole: 'auditor', status: 'offered' })])).handoffs!, 10_000);
    const trip = stage.plan.trips[0]!;
    const reconciler = (now: number) => stage.sample(now).actors.find(actor => actor.id === 'reconciler')!.position;
    expect(reconciler(trip.start)).toEqual(HANDOFF_AGENTS.reconciler.station);
    expect(reconciler(trip.arrive + 1)).toEqual(handoffSpot('auditor'));
  });

  it('labels the agents talking on a live handoff as live, not scripted', () => {
    const stage = new HandoffStage();
    stage.update(projectOfficeRows(liveRows([publicRow()])).handoffs!, 10_000);
    const source = agentChatSource('live', false);
    expect(source).toBe('Live handoff');
    const cues = agentChatTimeline(stage.plan, source);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every(cue => cue.source === 'Live handoff')).toBe(true);
  });
});
