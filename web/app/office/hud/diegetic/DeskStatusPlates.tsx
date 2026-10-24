'use client';

import { useMemo } from 'react';
import { BoxGeometry, MeshStandardMaterial, PlaneGeometry } from 'three';
import { PLATE_TONES, deskPlateKey, deskPlates, type DeskPlate } from '../../../../lib/office/hud-diegetic';
import { canvasTextLines } from '../../../../lib/office/props/readability';
import { PALETTE, ROLES } from '../../../../lib/office/palette';
import { PROP_FONT, useCanvasTexture } from '../../props/useCanvasTexture';
import type { SceneMountProps } from '../../mounts/types';
import { usePlayCamera } from './usePlayCamera';

// A hanging sign over each seated agent's desk: name, current task, status colour. Two draws per plate.
const PLATE_W = 1.56, PLATE_H = 0.56, HANG_Y = 2.5;
const TEX_W = 624, TEX_H = 224;
const FACE = new PlaneGeometry(PLATE_W, PLATE_H);
const FRAME = new BoxGeometry(PLATE_W + 0.06, PLATE_H + 0.06, 0.04);
const ROD = new BoxGeometry(0.02, 0.5, 0.02);
const FRAME_MATERIAL = new MeshStandardMaterial({ color: ROLES.frame, roughness: 0.7 });

function drawPlate(ctx: CanvasRenderingContext2D, plate: DeskPlate) {
  const tone = PLATE_TONES[plate.tone];
  const measure = (text: string) => ctx.measureText(text).width;
  ctx.fillStyle = PALETTE.cream;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = ROLES.frame;
  ctx.fillRect(0, 0, TEX_W, 10);
  // Status lamp: the tone colour as a tall swatch at the left edge, never as ink.
  ctx.fillStyle = tone.color;
  ctx.fillRect(0, 10, 22, TEX_H - 10);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = ROLES.text;
  ctx.font = `800 54px ${PROP_FONT}`;
  ctx.fillText(canvasTextLines(plate.name, measure, 300, 1)[0] ?? '', 44, 70);
  ctx.textAlign = 'right';
  ctx.font = `600 26px ${PROP_FONT}`;
  ctx.fillStyle = PALETTE.slate;
  ctx.fillText(plate.desk.toUpperCase(), TEX_W - 24, 64);
  ctx.textAlign = 'left';
  ctx.fillStyle = ROLES.text;
  ctx.font = `600 34px ${PROP_FONT}`;
  ctx.fillText(canvasTextLines(plate.task, measure, TEX_W - 70, 1)[0] ?? '', 44, 128);
  // Status pill: tone fill, navy ink (contrast holds on every palette tone).
  ctx.font = `700 26px ${PROP_FONT}`;
  const status = canvasTextLines(plate.status, measure, TEX_W - 100, 1)[0] ?? '';
  const pillW = Math.min(TEX_W - 66, measure(status) + 52);
  ctx.fillStyle = tone.color;
  ctx.beginPath();
  ctx.roundRect(44, 154, pillW, 46, 23);
  ctx.fill();
  ctx.fillStyle = ROLES.text;
  ctx.beginPath();
  ctx.arc(66, 177, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(status, 82, 186);
}

function Plate({ plate }: { plate: DeskPlate }) {
  const key = deskPlateKey(plate);
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawPlate(ctx, plate), [key]);
  return <group name={`hud-plate:${plate.agentId}`} position={[plate.at[0], HANG_Y, plate.at[1] - 0.15]} rotation={[-0.14, 0, 0]}>
    {[-0.62, 0.62].map(x => <mesh key={x} geometry={ROD} material={FRAME_MATERIAL} position={[x, PLATE_H / 2 + 0.25, -0.01]} />)}
    <mesh geometry={FRAME} material={FRAME_MATERIAL} position={[0, 0, -0.025]} />
    <mesh geometry={FACE}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  </group>;
}

/** HUD variant (c): agent status lives on signs over the desks, shown in Play only. View-only. */
export function DeskStatusPlates({ snapshot }: SceneMountProps) {
  const play = usePlayCamera();
  const plates = useMemo(() => deskPlates(snapshot), [snapshot]);
  if (!play) return null;
  return <group name='hud-diegetic-plates'>{plates.map(plate => <Plate key={plate.agentId} plate={plate} />)}</group>;
}
