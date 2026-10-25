'use client';

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, MeshStandardMaterial, PlaneGeometry, type Group } from 'three';
import { AGENT_DONE_MS, agentCardKey, agentCards, type AgentCard } from '../../../../lib/office/agent-cards';
import { deskPlates, type DeskPlate } from '../../../../lib/office/hud-diegetic';
import { canvasTextLines } from '../../../../lib/office/props/readability';
import { PALETTE, ROLES } from '../../../../lib/office/palette';
import { PROP_FONT, useCanvasTexture } from '../../props/useCanvasTexture';
import type { SceneMountProps } from '../../mounts/types';
import { usePlayCamera } from './usePlayCamera';

const PLATE_W = 1.56, PLATE_H = 0.56, HANG_Y = 2.5;
const TEX_W = 624, TEX_H = 224;
const FACE = new PlaneGeometry(PLATE_W, PLATE_H);
const FRAME = new BoxGeometry(PLATE_W + 0.06, PLATE_H + 0.06, 0.04);
const ROD = new BoxGeometry(0.02, 0.5, 0.02);
const FRAME_MATERIAL = new MeshStandardMaterial({ color: ROLES.frame, roughness: 0.7 });
// The overview mesh samples the pill from the SAME texture. Camera changes never repaint it.
const PILL = new PlaneGeometry(0.9, 0.9 * 46 / 280);
const pillUv = PILL.getAttribute('uv');
for (let i = 0; i < pillUv.count; i++) {
  pillUv.setXY(i, (44 + pillUv.getX(i) * 280) / TEX_W, (TEX_H - 200 + pillUv.getY(i) * 46) / TEX_H);
}

function drawPlate(ctx: CanvasRenderingContext2D, card: AgentCard) {
  const measure = (text: string) => ctx.measureText(text).width;
  ctx.fillStyle = PALETTE.cream;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = ROLES.frame;
  ctx.fillRect(0, 0, TEX_W, 10);
  ctx.fillStyle = PALETTE[card.agentColour];
  ctx.beginPath();
  ctx.roundRect(16, 30, 18, 98, 9);
  ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = ROLES.text;
  ctx.font = `800 34px ${PROP_FONT}`;
  ctx.fillText(canvasTextLines(card.title, measure, TEX_W - 68, 1)[0] ?? '', 44, 68);
  ctx.font = `600 32px ${PROP_FONT}`;
  ctx.fillText(canvasTextLines(card.line, measure, TEX_W - 68, 1)[0] ?? '', 44, 124);
  ctx.fillStyle = ROLES[card.colourRole];
  ctx.beginPath();
  ctx.roundRect(44, 154, 280, 46, 23);
  ctx.fill();
  ctx.fillStyle = ROLES.text;
  ctx.font = `800 28px ${PROP_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(card.tag, 184, 187);
}

function Plate({ plate, card, play }: { plate: DeskPlate; card: AgentCard; play: boolean }) {
  const group = useRef<Group>(null);
  const key = agentCardKey(card);
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawPlate(ctx, card), [key]);
  useFrame(({ camera }) => {
    const sign = group.current;
    if (!sign) return;
    sign.quaternion.copy(camera.quaternion);
    // Constant apparent size from 2–8 m; clamp beyond it. No vectors or arrays per frame.
    const distance = camera.position.distanceTo(sign.position);
    sign.scale.setScalar(play ? Math.min(8 / 3, Math.max(2 / 3, distance / 3)) : 1);
  });
  return <group ref={group} name={`hud-plate:${plate.agentId}`} position={[plate.at[0], HANG_Y, plate.at[1] - 0.15]}>
    {play && <>
      {[-0.62, 0.62].map(x => <mesh key={x} geometry={ROD} material={FRAME_MATERIAL} position={[x, PLATE_H / 2 + 0.25, -0.01]} />)}
      <mesh geometry={FRAME} material={FRAME_MATERIAL} position={[0, 0, -0.025]} />
    </>}
    <mesh geometry={play ? FACE : PILL}>
      <meshBasicMaterial map={texture} toneMapped={false} transparent={!play} />
    </mesh>
  </group>;
}

/** View-only cards over the existing desk anchors; overview shows just their status pills. */
export function DeskStatusPlates({ snapshot }: SceneMountProps) {
  const play = usePlayCamera();
  const canvas = useThree(state => state.gl.domElement);
  const [, tick] = useReducer((value: number) => value + 1, 0);
  const now = Date.now();
  const cards = agentCards(snapshot, now);
  const plates = useMemo(() => deskPlates(snapshot), [snapshot]);
  // Wake once at the next Done boundary, including when the subscription is otherwise silent.
  useEffect(() => {
    let next = Infinity;
    for (const row of snapshot.handoffs ?? []) {
      if (row.status !== 'completed' || row.completedAt === undefined) continue;
      const boundary = row.completedAt > now ? row.completedAt : row.completedAt + AGENT_DONE_MS;
      if (boundary > now) next = Math.min(next, boundary);
    }
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(tick, Math.min(2_147_483_647, Math.max(1, next - Date.now())));
    return () => clearTimeout(timer);
  }, [snapshot.handoffs, now]);
  const description = JSON.stringify(cards);
  useEffect(() => {
    canvas.dataset.agentCards = description;
    canvas.dataset.agentCardView = play ? 'full' : 'pill';
    return () => { delete canvas.dataset.agentCards; delete canvas.dataset.agentCardView; };
  }, [canvas, description, play]);
  return <group name='hud-diegetic-plates'>{plates.map((plate, i) => <Plate key={plate.agentId} plate={plate} card={cards[i]!} play={play} />)}</group>;
}
