import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { roomPropColliders } from './room-props';
import { officeColliders } from './play';
import { ANCHOR_IDS } from './layout';

describe('retired partition props', () => {
  it('detaches both wall decoration mounts and their invisible shelf obstacles', () => {
    const mounts = readFileSync(new URL('../../app/office/mounts/index.ts', import.meta.url), 'utf8');
    expect(mounts).not.toContain('Component: RoomProps');
    expect(mounts).not.toContain('Component: RoomDetail');
    const active = officeColliders(ANCHOR_IDS);
    for (const retired of roomPropColliders(ANCHOR_IDS)) expect(active).not.toContainEqual(retired);
  });
});
