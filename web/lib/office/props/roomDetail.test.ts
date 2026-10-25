import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deskKitPlacements } from '../deskkit';
import { ANCHOR_IDS } from '../layout';

describe('retired room decoration', () => {
  it('does not float wall art or room rugs in the open floor, including baked mode', () => {
    const mounts = readFileSync(new URL('../../../app/office/mounts/index.ts', import.meta.url), 'utf8');
    expect(mounts).not.toContain('Component: RoomDetail');
    expect(deskKitPlacements(ANCHOR_IDS).some(piece => piece.source.startsWith('detail:'))).toBe(false);
  });
});
