import { describe, expect, it } from 'vitest';
import { bakedArtRequested } from '../../app/office/mounts/BakedArt';
import { bakedReplacesAuditBoard, bakedReplacesPartition, bakedReplacesProps, withoutHiddenAuditBoard } from './baked-art';
import { officeColliders } from './play';

describe('baked art flag', () => {
  it('is off unless ?art=baked', () => {
    expect(bakedArtRequested('')).toBe(false);
    expect(bakedArtRequested('?perf=1')).toBe(false);
    expect(bakedArtRequested('?art=procedural')).toBe(false);
    expect(bakedArtRequested('?art=baked')).toBe(true);
    expect(bakedArtRequested('?perf=1&art=baked')).toBe(true);
  });
});

describe('procedural pieces the baked lobby replaces', () => {
  it('hides only the lobby lamp and plant, and only with baked art on', () => {
    expect(bakedReplacesProps(false, 'lobby')).toBe(false);
    expect(bakedReplacesProps(true, 'lobby')).toBe(true);
    expect(bakedReplacesProps(true, 'treasury')).toBe(false);
  });
  it('hides the lobby-side partition in first person only', () => {
    expect(bakedReplacesPartition(false, false, -2.5)).toBe(false);
    expect(bakedReplacesPartition(true, true, -2.5)).toBe(false);
    expect(bakedReplacesPartition(true, false, -2.5)).toBe(true);
    expect(bakedReplacesPartition(true, false, 2.5)).toBe(false);
  });
  it('hides the freestanding audit board and its collider in baked first person only', () => {
    expect(bakedReplacesAuditBoard(false, false)).toBe(false);
    expect(bakedReplacesAuditBoard(true, true)).toBe(false);
    expect(bakedReplacesAuditBoard(true, false)).toBe(true);
    const all = officeColliders(['lobby']);
    const board = (b: { minX: number; maxZ: number }) => Math.abs(b.minX + 6.9) < 1e-6 && Math.abs(b.maxZ - 3.975) < 1e-6;
    expect(all.some(board)).toBe(true);
    expect(withoutHiddenAuditBoard(all, false)).toEqual(all);
    const baked = withoutHiddenAuditBoard(all, true);
    expect(baked.some(board)).toBe(false);
    expect(baked).toHaveLength(all.length - 1);
  });
});
