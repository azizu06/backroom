'use client';

import { useMemo } from 'react';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { WHITEBOARD_INTERACTION, whiteboardStats, type WhiteboardStats } from '../../../lib/office/props/whiteboard';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

const DECISION_COLORS = { ALLOW: '#a9bc8f', DENY: '#ed6252', ESCALATE: '#e0b365', RECORDED: '#8c9c87' } as const;
const DECISION_LABELS = { ALLOW: 'ALLOW', DENY: 'DENY', ESCALATE: 'HOLD', RECORDED: 'REC' } as const;
const WIDTH = 2.4, HEIGHT = 1.4, BOTTOM = 1.15, FACE_W = 2.26, FACE_H = 1.26;
const TEX_W = 512, TEX_H = Math.round(TEX_W * FACE_H / FACE_W);

function drawBoard(ctx: CanvasRenderingContext2D, stats: WhiteboardStats) {
  ctx.fillStyle = '#f1ede2';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#303d34';
  ctx.font = `600 26px ${PROP_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('Payables board', 20, 38);
  ctx.textAlign = 'right';
  ctx.font = `500 20px ${PROP_FONT}`;
  ctx.fillText(`Inbox ${stats.inbox}`, TEX_W - 20, 38);
  ctx.fillStyle = '#c9c1ad';
  ctx.fillRect(20, 50, TEX_W - 40, 2);
  const counts = [['ALLOW', stats.allow], ['DENY', stats.deny], ['ESCALATE', stats.escalate]] as const;
  counts.forEach(([decision, value], i) => {
    const x = 20 + (i + 0.5) * ((TEX_W - 40) / 3);
    ctx.textAlign = 'center';
    ctx.fillStyle = DECISION_COLORS[decision];
    ctx.font = `700 64px ${PROP_FONT}`;
    ctx.fillText(String(value), x, 122);
    ctx.font = `600 18px ${PROP_FONT}`;
    ctx.fillText(DECISION_LABELS[decision], x, 146);
  });
  ctx.textAlign = 'left';
  ctx.font = `500 18px ${PROP_FONT}`;
  if (!stats.recent.length) {
    ctx.fillStyle = '#6b6f63';
    ctx.fillText('No receipts yet', 20, 192);
  }
  stats.recent.forEach((row, i) => {
    const y = 192 + i * 30;
    ctx.fillStyle = DECISION_COLORS[row.decision];
    ctx.fillRect(20, y - 14, 14, 14);
    ctx.fillStyle = '#303d34';
    ctx.fillText(`${DECISION_LABELS[row.decision]} · ${row.summary}`, 44, y);
  });
}

function Board({ snapshot }: { snapshot: OfficeSnapshot }) {
  const stats = useMemo(() => whiteboardStats(snapshot), [snapshot]);
  const { allow, deny, escalate, inbox, recent } = stats;
  const key = JSON.stringify({ allow, deny, escalate, inbox, recent });
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawBoard(ctx, stats), [key]);
  return <group name='prop:whiteboard' position={[1.1, 0, -5.38]}>
    <mesh position={[0, BOTTOM + HEIGHT / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[WIDTH, HEIGHT, 0.06]} /><meshStandardMaterial color='#5a6156' roughness={0.8} />
    </mesh>
    <mesh position={[0, BOTTOM + HEIGHT / 2, 0.031]} receiveShadow>
      <planeGeometry args={[FACE_W, FACE_H]} />
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive='#ffffff' emissiveIntensity={0.3} roughness={1} />
    </mesh>
    <mesh position={[0, BOTTOM - 0.02, 0.07]} receiveShadow>
      <boxGeometry args={[1.1, 0.05, 0.14]} /><meshStandardMaterial color='#7d8874' roughness={0.9} />
    </mesh>
    {[-0.2, 0, 0.2].map((x, i) => <mesh key={x} position={[x, BOTTOM + 0.02, 0.08]} rotation={[0, 0, Math.PI / 2]} receiveShadow>
      <boxGeometry args={[0.035, 0.16, 0.035]} /><meshStandardMaterial color={[DECISION_COLORS.ALLOW, DECISION_COLORS.DENY, DECISION_COLORS.ESCALATE][i]} />
    </mesh>)}
  </group>;
}

/** Payables back-wall board above the low wall, facing +z. Shown only while payables is visible. */
export function Whiteboard({ snapshot }: { snapshot: OfficeSnapshot }) {
  return WHITEBOARD_INTERACTION.visible(snapshot) ? <Board snapshot={snapshot} /> : null;
}
