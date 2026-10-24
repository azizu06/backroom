import type { Policy } from '@backroom/policy';
import type { Agent, AuditEntry, Escalation, Task } from '../store';

export interface ReplayState {
  agents: Agent[];
  tasks: Task[];
  escalations: Escalation[];
  policy: Policy;
  llmEnabled: boolean;
}
export interface ReplayHeader {
  kind: 'backroom-replay'; version: 1; name: string; recordedAt: string; provenance: string;
}
export interface ReplayFrame {
  kind: 'frame'; index: number; atMs: number; phase: string; operation: string;
  state: ReplayState; audit: AuditEntry[];
}
export interface ReplayRecording {
  header: ReplayHeader; frames: ReplayFrame[]; durationMs: number;
}
