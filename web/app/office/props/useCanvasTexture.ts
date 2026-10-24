'use client';

import { useLayoutEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';

export const PROP_FONT = 'system-ui, sans-serif';

/**
 * One canvas + CanvasTexture per prop. Redraws only when `deps` change, then requests a single
 * on-demand frame; never draws per frame. The texture is disposed on unmount.
 */
export function useCanvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]): CanvasTexture {
  const invalidate = useThree(state => state.invalidate);
  const [texture] = useState(() => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const created = new CanvasTexture(canvas);
    created.colorSpace = SRGBColorSpace;
    created.anisotropy = 4;
    return created;
  });
  useLayoutEffect(() => {
    const ctx = (texture.image as HTMLCanvasElement).getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    draw(ctx);
    texture.needsUpdate = true;
    invalidate();
    // `draw` is a fresh closure each render; callers list what it reads in `deps`.
  }, [texture, width, height, invalidate, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
