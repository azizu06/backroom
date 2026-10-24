'use client';

import { useLayoutEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { canvasTextureSize } from '../../../lib/office/props/readability';

export const PROP_FONT = 'system-ui, sans-serif';

/**
 * One canvas + CanvasTexture per prop. Redraws only when `deps` change, then requests a single
 * on-demand frame; never draws per frame. The texture is disposed on unmount.
 * `width` and `height` are fixed at mount; later values are ignored.
 */
export function useCanvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]): CanvasTexture {
  const invalidate = useThree(state => state.invalidate);
  const [texture] = useState(() => {
    const canvas = document.createElement('canvas');
    const size = canvasTextureSize(width, height);
    canvas.width = size.width;
    canvas.height = size.height;
    const created = new CanvasTexture(canvas);
    created.colorSpace = SRGBColorSpace;
    created.anisotropy = 4;
    return created;
  });
  useLayoutEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    draw(ctx);
    texture.needsUpdate = true;
    invalidate();
    // `draw` is a fresh closure each render; callers list what it reads in `deps`.
  }, [texture, invalidate, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
