import type { AuditEntry } from '@backroom/orchestrator';
import type { ReplayRecording, ReplayFrame } from '../../../orchestrator/src/replay/types';
import { WalkMotion } from '../office/motion';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot, type OfficeState, type SeatId } from '../office/state';

const seatNames: Record<SeatId, string> = { collections: 'Alex', payables: 'Sam', vendor_onboarding: 'Jules' };
function anchor(value: string | undefined, seat: SeatId): AnchorId {
  const candidate = value?.toLowerCase().replace(/_desk$/, '');
  return candidate && candidate in OFFICE_ANCHORS ? candidate as AnchorId : seat;
}
function project(frame: ReplayFrame, entries: AuditEntry[], positions: Map<string, WalkMotion>): OfficeSnapshot {
  const { state } = frame;
  return { connection: 'replay', llmEnabled: state.llmEnabled, inboxCount: state.tasks.filter(row => row.status === 'queued').length,
    badges: Object.entries(state.policy.badges).map(([seatId, badge]) => ({
      seatId: seatId as SeatId, policyVersion: state.policy.policyVersion, actions: badge.actions, rooms: badge.rooms,
      limits: 'limits' in badge ? { ...badge.limits } : 'maxPaymentCents' in badge ? { maxPaymentCents: badge.maxPaymentCents, account: badge.account } : {},
    })),
    agents: state.agents.map(agent => {
      const task = state.tasks.find(task => task.id === agent.currentTaskId);
      const escalation = state.escalations.find(row => row.id === task?.escalationId || row.fromAgent === agent.id && row.status === 'pending');
      return { id: agent.id, name: `${seatNames[agent.seatId]} · ${agent.id}`, seatId: agent.seatId,
        pos: [...positions.get(agent.id)!.position], targetAnchor: anchor(agent.targetAnchor, agent.seatId), state: agent.state,
        escalationId: escalation?.status === 'pending' ? escalation.id : undefined };
    }),
    audit: entries.flatMap(entry => !entry.decision || entry.seat === 'controller' ? [] : [{
      id: entry.id, agentId: state.agents.find(agent => agent.seatId === entry.seat)?.id ?? '', seatId: entry.seat,
      action: entry.action, decision: entry.decision, ruleIds: entry.ruleIds,
      summary: `${entry.action.replaceAll('_', ' ')} · ${entry.refs.join(', ')}`,
    }]), denials: [],
  };
}
export function createReplayPlayer(recording: ReplayRecording) {
  const listeners = new Set<() => void>();
  let positionMs = 0, speed = 1, playing = false;
  let office: OfficeSnapshot = { ...INITIAL_OFFICE, connection: 'replay' };
  const first = recording.frames[0]!;
  let snapshot = { positionMs, speed, playing, phase: first.phase, entries: [] as AuditEntry[], measuredAt: recording.header.recordedAt };
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  function publish() {
    const reached = recording.frames.filter(frame => frame.atMs <= positionMs);
    const frame = reached.at(-1) ?? first;
    const entries = reached.filter(row => row.phase === frame.phase).flatMap(row => row.audit);
    // Reconstruct interpolation from the timeline on every sample: pause/speed/scrub also apply to avatars.
    // This is visual projection only; no policy, reducers, effects, tools or models are reachable.
    const positions = new Map<string, WalkMotion>();
    const targets = new Map<string, AnchorId>();
    let previous = 0;
    const advance = (ms: number) => {
      let seconds = ms / 1000;
      while (seconds > 0) { const delta = Math.min(seconds, 0.1); positions.forEach(walk => walk.advance(delta)); seconds -= delta; }
    };
    for (const row of reached.filter(row => row.phase === frame.phase)) {
      advance(row.atMs - previous); previous = row.atMs;
      for (const agent of row.state.agents) {
        if (!positions.has(agent.id)) positions.set(agent.id, new WalkMotion(OFFICE_ANCHORS[agent.seatId].position));
        const walk = positions.get(agent.id)!;
        const destination = anchor(agent.targetAnchor, agent.seatId);
        // moveTo only when the recorded target changes; repeated snapshots must not reset a walk.
        const key = `${agent.id}:target`;
        if (targets.get(key) !== destination) { walk.moveTo(destination); targets.set(key, destination); }
      }
    }
    advance(Math.max(0, positionMs - previous));
    office = reached.length ? project(frame, entries, positions) : { ...INITIAL_OFFICE, connection: 'replay' };
    snapshot = { positionMs, speed, playing, phase: frame.phase, entries,
      measuredAt: new Date(Date.parse(recording.header.recordedAt) + positionMs).toISOString() };
    listeners.forEach(listener => listener());
  }
  const refresh = publish;
  refresh();
  return {
    source: { getSnapshot: () => office, subscribe } satisfies OfficeState,
    getSnapshot: () => snapshot, subscribe,
    play() { playing = positionMs < recording.durationMs; refresh(); },
    pause() { playing = false; refresh(); },
    setSpeed(value: number) { if (!Number.isFinite(value) || value < 0.1 || value > 8) throw new Error('INVALID_REPLAY_SPEED'); speed = value; refresh(); },
    seek(value: number) { if (!Number.isFinite(value)) return; positionMs = Math.max(0, Math.min(value, recording.durationMs)); if (positionMs === recording.durationMs) playing = false; refresh(); },
    advance(elapsedMs: number) {
      if (!playing || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
      positionMs = Math.min(recording.durationMs, positionMs + elapsedMs * speed);
      if (positionMs === recording.durationMs) playing = false;
      refresh();
    },
  };
}
