'use client';

import { useEffect } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import { Box3, Vector3, type Object3D } from 'three';
import { BEAR_HEIGHT } from '../../../lib/office/bear';
import { seatAtApproach } from '../../../lib/office/baked-seat';
import type { BearRig } from './Bear';

export interface SeatProbeRow {
  name: string;
  blend: number;
  heading: number;
  seat: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
}
export type SeatProbeCanvas = HTMLCanvasElement & { officeSeatBounds?: () => SeatProbeRow[] };

/** Project after the scene's pose writes, so DOM plates follow the drawn head during a seat tween. */
export function AvatarAnchors({ rig, object }: { rig?: BearRig; object?: Object3D }) {
  const get = useThree(state => state.get);
  useEffect(() => {
    const point = new Vector3();
    return addAfterEffect(() => {
      const model = object ?? rig?.root;
      const owner = object ?? model?.parent;
      if (!model || !owner) return;
      const handoff = owner.name.startsWith('handoff-agent:');
      const id = owner.name.split(':').slice(1).join(':');
      if (!id) return;
      const element = document.querySelector<HTMLElement>(`[${handoff ? 'data-handoff-actor' : 'data-agent-tag'}="${CSS.escape(id)}"]`);
      if (!element) return;
      const { camera, size } = get();
      model.getWorldPosition(point);
      point.y = Math.max(1.95, point.y + BEAR_HEIGHT + 0.25);
      point.project(camera);
      element.style.transform = `translate(${(point.x + 1) * size.width / 2}px, ${(1 - point.y) * size.height / 2}px) translate(-50%, -100%)`;
    });
  }, [get, object, rig]);

  useEffect(() => {
    // Explicit browser-test opt-in: measure rendered meshes, not predicted pose bounds.
    if (!new URLSearchParams(window.location.search).has('seatProbe')) return;
    const canvas = get().gl.domElement as SeatProbeCanvas;
    const probe = () => {
      const { scene } = get();
      scene.updateMatrixWorld(true);
      const rows: SeatProbeRow[] = [];
      scene.traverse(owner => {
        const motion = owner.userData.agentMotion as { x: number; z: number; seated: number } | undefined;
        if (!motion) return;
        const seat = seatAtApproach(motion.x, motion.z);
        const model = owner.getObjectByName('bear') ?? scene.getObjectByName(owner.name.replace('agent:', 'baked-character:'));
        if (!seat || !model) return;
        const box = new Box3().setFromObject(model, true);
        rows.push({ name: owner.name, blend: motion.seated, heading: owner.rotation.y, seat,
          bounds: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, maxY: box.max.y } });
      });
      return rows;
    };
    canvas.officeSeatBounds = probe;
    return () => { if (canvas.officeSeatBounds === probe) delete canvas.officeSeatBounds; };
  }, [get]);
  return null;
}
