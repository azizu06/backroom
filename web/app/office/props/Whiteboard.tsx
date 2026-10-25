'use client';

import { useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import type { FurniturePiece } from '../../../lib/office/furniture';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { WHITEBOARD_INTERACTION, whiteboardStats, type WhiteboardStats } from '../../../lib/office/props/whiteboard';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { StaticBoxes } from '../mounts/StaticGeometry';
import { BUILDING } from '../../../lib/office/layout';
import { PALETTE, ROLES } from '../../../lib/office/palette';

const DECISION_COLORS = { ALLOW: PALETTE.mint, DENY: ROLES.deny, ESCALATE: PALETTE.butter, RECORDED: PALETTE.lavender } as const;
const DECISION_LABELS = { ALLOW: 'ALLOW', DENY: 'DENY', ESCALATE: 'HOLD', RECORDED: 'REC' } as const;
const WIDTH = 2.4, HEIGHT = 1.4, BOTTOM = 1.15, FACE_W = 2.26, FACE_H = 1.26;
const TEX_W = 512, TEX_H = Math.round(TEX_W * FACE_H / FACE_W);
const MARKER_MATERIAL = new MeshStandardMaterial({ vertexColors: true });
const MARKERS: FurniturePiece[] = [-0.2, 0, 0.2].map((x, i) => ({ at: [x, BOTTOM + 0.02, 0.08],
  size: [0.035, 0.16, 0.035], rotation: [0, 0, Math.PI / 2], color: [DECISION_COLORS.ALLOW, DECISION_COLORS.DENY, DECISION_COLORS.ESCALATE][i]! }));

function drawBoard(ctx: CanvasRenderingContext2D, stats: WhiteboardStats) {
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
    ctx.fillText(String(value), x, 118);
    ctx.fillStyle = DECISION_COLORS[decision];
    ctx.fillRect(x - 44, 128, 88, 8);
    ctx.strokeStyle = ROLES.frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 44, 128, 88, 8);
    ctx.fillStyle = ROLES.text;
    ctx.font = `600 18px ${PROP_FONT}`;
    ctx.fillText(DECISION_LABELS[decision], x, 160);
  });
  ctx.textAlign = 'left';
  ctx.font = `500 18px ${PROP_FONT}`;
  if (!stats.recent.length) {
    ctx.fillStyle = ROLES.text;
    ctx.fillText('No receipts yet', 20, 192);
  }
  stats.recent.forEach((row, i) => {
    const y = 192 + i * 30;
    ctx.fillStyle = DECISION_COLORS[row.decision];
    ctx.fillRect(20, y - 14, 14, 14);
    ctx.strokeStyle = ROLES.frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(20, y - 14, 14, 14);
    ctx.fillStyle = ROLES.text;
    ctx.fillText(`${DECISION_LABELS[row.decision]} · ${row.summary}`, 44, y);
  });
}

function Board({ snapshot }: { snapshot: OfficeSnapshot }) {
  const stats = useMemo(() => whiteboardStats(snapshot), [snapshot]);
  const { allow, deny, escalate, inbox, recent } = stats;
  const key = JSON.stringify({ allow, deny, escalate, inbox, recent });
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawBoard(ctx, stats), [key]);
  return <group name='prop:whiteboard' position={[WHITEBOARD_INTERACTION.position[0], 0, BUILDING.minZ + 0.12]}>
    <mesh position={[0, BOTTOM + HEIGHT / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[WIDTH, HEIGHT, 0.06]} /><meshStandardMaterial color={ROLES.frame} roughness={0.8} />
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
