import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { AgentChatLayout, CHAT_HEIGHT, CHAT_WIDTH, CHAT_Y } from './agent-chat-layout';
import type { AgentChatCue } from './agent-chat';
import type { ActorFrame } from './handoff-plan';
import { HANDOFF_ROLES, type HandoffAgentId } from './handoffs';

const cue = (actor: HandoffAgentId): AgentChatCue => ({ actor, phase: 'sender', start: 0, end: 3500,
  text: 'Passing documents.', status: 'Passing documents', source: 'Scripted' });
const actor = (id: HandoffAgentId, x = 0, z = 0): ActorFrame => ({ id, position: [x, z],
  heading: 0, moving: false, stride: 0, returning: false });

describe('in-world chat placement', () => {
  it('skips cues with missing actors, including when an active actor disappears', () => {
    const layout = new AgentChatLayout(), camera = new OrthographicCamera(-10, 10, 10, -10);
    camera.position.set(0, 0, 10); camera.updateMatrixWorld();
    const cues = [cue('intake'), cue('extractor')];
    expect(layout.sample(cues, [actor('extractor')], camera).map(entry => entry.cue)).toEqual([cues[1]]);
    expect(layout.sample(cues, [], camera)).toEqual([]);
  });

  for (const projection of ['perspective', 'orthographic'] as const) {
    it(`keeps simultaneous plates below 2.7 m and apart in ${projection} views`, () => {
      const camera = projection === 'perspective' ? new PerspectiveCamera(65, 1.5, 0.1, 100)
        : new OrthographicCamera(-10, 10, 7, -7, 0.1, 100);
      camera.position.set(3, 6, 10); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
      const layout = new AgentChatLayout();
      const cues = HANDOFF_ROLES.map(cue);
      // Nearby agents at varied depths, including coincident anchors.
      const actors = HANDOFF_ROLES.map((id, i) => actor(id, i % 2 * 0.1, i % 3 * 0.3));
      const entries = layout.sample(cues, actors, camera);
      expect(entries).toHaveLength(cues.length);
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      for (const entry of entries) {
        expect(entry.position.y).toBeCloseTo(CHAT_Y);
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          const corner = entry.position.clone().addScaledVector(right, x * CHAT_WIDTH / 2)
            .addScaledVector(up, y * CHAT_HEIGHT / 2);
          expect(corner.y).toBeLessThanOrEqual(2.7);
          corner.project(camera);
          expect(corner.x).toBeGreaterThanOrEqual(entry.left - 1e-8);
          expect(corner.x).toBeLessThanOrEqual(entry.right + 1e-8);
        }
      }
      for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!, b = entries[j]!;
        expect(a.right <= b.left || b.right <= a.left || a.top <= b.bottom || b.top <= a.bottom).toBe(true);
      }
      const slot = entries[0]!, position = slot.position;
      expect(layout.sample(cues, actors, camera)).toBe(entries);
      expect(entries[0]).toBe(slot);
      expect(entries[0]!.position).toBe(position);
    });
  }
});
