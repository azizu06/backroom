import { Vector3, type Camera } from 'three';
import type { AgentChatCue } from './agent-chat';
import type { ActorFrame } from './handoff-plan';
import { HANDOFF_AGENTS, type HandoffAgentId } from './handoffs';

export const CHAT_WIDTH = 2.2, CHAT_HEIGHT = 1.1, CHAT_Y = 2.1;
const GAP = 0.12;

class ChatPlacement {
  cue!: AgentChatCue;
  readonly position = new Vector3();
  left = 0; right = 0; bottom = 0; top = 0;
  unitX = 0;
}
const byLeft = (a: ChatPlacement, b: ChatPlacement) => a.left - b.left;

/** Reuses actor slots and projection scratch. Only the office's unrolled cameras are used here. */
export class AgentChatLayout {
  readonly entries: ChatPlacement[] = [];
  private readonly slots = new Map<HandoffAgentId, ChatPlacement>();
  private readonly right = new Vector3();
  private readonly center = new Vector3();
  private readonly edge = new Vector3();

  constructor() {
    for (const id of Object.keys(HANDOFF_AGENTS) as HandoffAgentId[]) {
      this.slots.set(id, new ChatPlacement());
    }
  }

  sample(cues: readonly AgentChatCue[], actors: readonly ActorFrame[], camera: Camera): readonly ChatPlacement[] {
    let count = 0;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    for (const cue of cues) {
      let actor: ActorFrame | undefined;
      for (const candidate of actors) if (candidate.id === cue.actor) { actor = candidate; break; }
      const slot = this.slots.get(cue.actor);
      // A public cue can outlive its actor projection; never render it without an anchor.
      if (!actor || !slot) continue;
      slot.cue = cue;
      slot.position.set(actor.position[0], CHAT_Y, actor.position[1]);
      this.center.copy(slot.position).project(camera);
      this.edge.copy(slot.position).add(this.right).project(camera);
      slot.unitX = this.edge.x - this.center.x;
      if (slot.unitX <= 0 || this.center.z > 1) continue;
      const halfWidth = slot.unitX * CHAT_WIDTH / 2;
      // Billboards share the camera's right/up axes, so their corners have the same depth.
      this.edge.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(CHAT_HEIGHT / 2)
        .add(slot.position).project(camera);
      const halfHeight = Math.abs(this.edge.y - this.center.y);
      slot.left = this.center.x - halfWidth; slot.right = this.center.x + halfWidth;
      slot.bottom = this.center.y - halfHeight; slot.top = this.center.y + halfHeight;
      this.entries[count++] = slot;
    }
    this.entries.length = count;
    this.entries.sort(byLeft);
    for (let i = 0; i < this.entries.length; i++) {
      const slot = this.entries[i]!;
      let shift = 0;
      for (let j = 0; j < i; j++) {
        const previous = this.entries[j]!;
        if (slot.bottom >= previous.top || slot.top <= previous.bottom) continue;
        if (slot.right + shift <= previous.left || slot.left + shift >= previous.right) continue;
        shift = previous.right + GAP * slot.unitX - slot.left;
        // Moving right may encounter an earlier plate again; recheck the placed row.
        j = -1;
      }
      slot.position.addScaledVector(this.right, shift / slot.unitX);
      slot.left += shift; slot.right += shift;
    }
    return this.entries;
  }
}
