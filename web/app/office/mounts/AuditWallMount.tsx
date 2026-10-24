'use client';

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { PROP_FONT, useCanvasTexture } from '../props/useCanvasTexture';
import { AUDIT_WALL, auditWallNoticeLines, auditWallText, auditWallView, auditWallVisible, type AuditWallView } from '../../../lib/office/props/auditWall';
import type { SceneMountProps } from './types';

const DECISION_COLORS = { ALLOW: '#a9bc8f', DENY: '#ed6252', ESCALATE: '#e0b365', RECORDED: '#8c9c87' } as const;
const DECISION_LABELS = { ALLOW: 'ALLOW', DENY: 'DENY', ESCALATE: 'HOLD', RECORDED: 'REC' } as const;
const TEX_W = 704, TEX_H = Math.round(TEX_W * AUDIT_WALL.faceHeight / AUDIT_WALL.faceWidth);
const ROW_TOP = 74, ROW_H = 54;

function drawWall(ctx: CanvasRenderingContext2D, view: AuditWallView) {
  ctx.fillStyle = '#18201b';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#d8e5d0';
  ctx.font = `600 30px ${PROP_FONT}`;
  ctx.fillText('Audit wall', 22, 42);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9fae9a';
  ctx.font = `500 20px ${PROP_FONT}`;
  ctx.fillText(view.notice ? view.connection : `${view.total} receipts · ${view.connection}`, TEX_W - 22, 42);
  ctx.fillStyle = '#3a4a3f';
  ctx.fillRect(22, 54, TEX_W - 44, 2);
  ctx.textAlign = 'left';
  if (!view.rows.length) {
    ctx.fillStyle = '#9fae9a';
    ctx.font = `500 24px ${PROP_FONT}`;
    // Preview and replay feeds are not the audit log: paint the shared notice on two lines instead of their rows.
    const [first, second] = view.notice ? auditWallNoticeLines(view.notice) : ['No receipts yet', ''];
    ctx.fillText(first, 22, ROW_TOP + 36);
    if (second) ctx.fillText(second, 22, ROW_TOP + 72);
    return;
  }
  view.rows.forEach((row, i) => {
    const y = ROW_TOP + i * ROW_H;
    ctx.fillStyle = DECISION_COLORS[row.decision];
    ctx.fillRect(22, y + 4, 8, 36);
    ctx.font = `700 18px ${PROP_FONT}`;
    ctx.fillText(DECISION_LABELS[row.decision], 42, y + 18);
    ctx.fillStyle = '#e7efe1';
    ctx.font = `500 22px ${PROP_FONT}`;
    ctx.fillText(row.summary, 112, y + 20);
    ctx.fillStyle = '#9fae9a';
    ctx.font = `500 17px ui-monospace, monospace`;
    ctx.fillText(row.receipt, 112, y + 42);
  });
}

function Wall({ snapshot }: SceneMountProps) {
  const view = useMemo(() => auditWallView(snapshot), [snapshot]);
  const text = auditWallText(view);
  const key = `${view.total}|${view.connection}|${view.notice ?? ''}|${text}`;
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawWall(ctx, view), [key]);
  const canvas = useThree(state => state.gl.domElement);
  // The wall is pixels, so mirror its text onto the canvas element: aria-description for assistive tech, data attribute for tests.
  useEffect(() => {
    canvas.dataset.auditWall = text;
    canvas.setAttribute('aria-description', `Lobby audit wall, newest first:\n${text || view.notice || 'no receipts yet'}`);
    return () => { delete canvas.dataset.auditWall; canvas.removeAttribute('aria-description'); };
  }, [canvas, text, view.notice]);
  const { width, height, faceWidth, faceHeight, bottom } = AUDIT_WALL;
  return <group name='mount:audit-wall' position={[AUDIT_WALL.x, 0, AUDIT_WALL.z]} rotation={[0, Math.PI / 2, 0]}>
    <mesh position={[0, bottom + height / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, height, 0.06]} /><meshStandardMaterial color='#303d34' roughness={0.8} />
    </mesh>
    <mesh position={[0, bottom + height / 2, 0.031]}>
      <planeGeometry args={[faceWidth, faceHeight]} />
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive='#ffffff' emissiveIntensity={0.45} roughness={1} />
    </mesh>
  </group>;
}

/** Audit wall on the lobby's west wall: the newest receipts, with their ids, as a canvas texture. View-only. */
export function AuditWallMount({ snapshot }: SceneMountProps) {
  return auditWallVisible(snapshot) ? <Wall snapshot={snapshot} /> : null;
}
