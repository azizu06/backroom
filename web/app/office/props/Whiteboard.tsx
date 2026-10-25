'use client';

import { useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import type { FurniturePiece } from '../../../lib/office/furniture';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { WHITEBOARD, WHITEBOARD_INTERACTION, whiteboardStats, type WhiteboardStats } from '../../../lib/office/props/whiteboard';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { StaticBoxes } from '../mounts/StaticGeometry';
import { BUILDING, WALL_THICKNESS } from '../../../lib/office/layout';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { canvasTextLines } from '../../../lib/office/hud-diegetic';

const DECISION_COLORS = { ALLOW: PALETTE.mint, DENY: ROLES.deny, ESCALATE: PALETTE.butter, RECORDED: PALETTE.lavender } as const;
const DECISION_LABELS = { ALLOW: 'ALLOW', DENY: 'DENY', ESCALATE: 'HOLD', RECORDED: 'REC' } as const;
const { width: WIDTH, height: HEIGHT, bottom: BOTTOM, faceWidth: FACE_W, faceHeight: FACE_H } = WHITEBOARD;
const TEX_W = 512, TEX_H = Math.round(TEX_W * FACE_H / FACE_W);
const MARKER_MATERIAL = new MeshStandardMaterial({ vertexColors: true });
const MARKERS: FurniturePiece[] = [-0.2, 0, 0.2].map((x, i) => ({ at: [x, BOTTOM + 0.02, 0.08],
  size: [0.035, 0.16, 0.035], rotation: [0, 0, Math.PI / 2], color: [DECISION_COLORS.ALLOW, DECISION_COLORS.DENY, DECISION_COLORS.ESCALATE][i]! }));

export function drawBoard(ctx: CanvasRenderingContext2D, stats: WhiteboardStats) {
  ctx.fillStyle = ROLES.wall;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ROLES.text;
  ctx.font = `600 26px ${PROP_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('Payables board', 20, 38);
  ctx.textAlign = 'right';
  ctx.font = `500 20px ${PROP_FONT}`;
  ctx.fillText(`Inbox ${stats.inbox}`, TEX_W - 20, 38);
  ctx.fillStyle = ROLES.shadow;
  ctx.fillRect(20, 50, TEX_W - 40, 2);
  const counts = [['ALLOW', stats.allow], ['DENY', stats.deny], ['ESCALATE', stats.escalate]] as const;
  counts.forEach(([decision, value], i) => {
    const x = 20 + (i + 0.5) * ((TEX_W - 40) / 3);
    ctx.textAlign = 'center';
    // Numerals and labels stay navy for contrast; the decision colour is a bar under the number.
    ctx.fillStyle = ROLES.text;
    ctx.font = `700 64px ${PROP_FONT}`;
    ctx.fillText(String(value), x, 100);
    ctx.fillStyle = DECISION_COLORS[decision];
    ctx.fillRect(x - 44, 110, 88, 8);
    ctx.strokeStyle = ROLES.frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 44, 110, 88, 8);
    ctx.fillStyle = ROLES.text;
    ctx.font = `600 18px ${PROP_FONT}`;
    ctx.fillText(DECISION_LABELS[decision], x, 140);
  });
  ctx.textAlign = 'left';
  ctx.font = `500 18px ${PROP_FONT}`;
  if (!stats.recent.length) {
    ctx.fillStyle = ROLES.text;
    ctx.fillText('No receipts yet', 20, 192);
  }
  stats.recent.forEach((row, i) => {
    const y = 164 + i * 40;
    ctx.fillStyle = DECISION_COLORS[row.decision];
    ctx.fillRect(20, y - 14, 14, 14);
    ctx.strokeStyle = ROLES.frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(20, y - 14, 14, 14);
    ctx.fillStyle = ROLES.text;
    canvasTextLines(`${DECISION_LABELS[row.decision]} · ${row.summary}`, text => ctx.measureText(text).width, TEX_W - 64, 2)
      .forEach((text, line) => ctx.fillText(text, 44, y + line * 20));
  });
}

function Board({ snapshot }: { snapshot: OfficeSnapshot }) {
  const stats = useMemo(() => whiteboardStats(snapshot), [snapshot]);
  const { allow, deny, escalate, inbox, recent } = stats;
  const key = JSON.stringify({ allow, deny, escalate, inbox, recent });
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawBoard(ctx, stats), [key]);
  return <group name='prop:whiteboard' position={[WHITEBOARD_INTERACTION.position[0], 0, BUILDING.minZ + WALL_THICKNESS / 2 + WHITEBOARD.depth / 2]}>
    <mesh position={[0, BOTTOM + HEIGHT / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[WIDTH, HEIGHT, WHITEBOARD.depth]} /><meshStandardMaterial color={ROLES.frame} roughness={0.8} />
    </mesh>
    <mesh position={[0, BOTTOM + HEIGHT / 2, 0.031]} receiveShadow>
      <planeGeometry args={[FACE_W, FACE_H]} />
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive={ROLES.wall} emissiveIntensity={0.3} roughness={1} />
    </mesh>
    <mesh position={[0, BOTTOM - 0.02, 0.07]} receiveShadow>
      <boxGeometry args={[1.1, 0.05, 0.14]} /><meshStandardMaterial color={ROLES.partition} roughness={0.9} />
    </mesh>
    <StaticBoxes pieces={MARKERS} material={MARKER_MATERIAL} castShadow={false} />
  </group>;
}

/** Payables back-wall board, facing +z. Shown only while payables is visible. */
export function Whiteboard({ snapshot }: { snapshot: OfficeSnapshot }) {
  return WHITEBOARD_INTERACTION.visible(snapshot) ? <Board snapshot={snapshot} /> : null;
}
