'use client';

import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { OFFICE_ANCHORS, type OfficeSnapshot } from '../../../lib/office/state';
import { MONITOR_DESKS, MONITOR_FACE, MONITOR_TEXTURE, monitorInteraction, monitorOverview, monitorScreen, monitorScreenKey, type MonitorDesk, type MonitorScreen, type MonitorStatusKey } from '../../../lib/office/props/monitors';
import { canvasTextLines } from '../../../lib/office/props/readability';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

const STATUS_COLORS: Record<MonitorStatusKey, string> = { allow: '#b9d59b', deny: '#ff998c', escalate: '#f3dfb9', recorded: '#d0d6c6' };
const LINE_COLORS = { agent: '#f2f5ed', away: '#d0d6c6', folder: '#f3dfb9', idle: '#d0d6c6', awaiting: '#f2f5ed', escalation: '#d0d6c6' } as const;
const { width: TEX_W, height: TEX_H, overviewFont } = MONITOR_TEXTURE;
const { width: FACE_W, height: FACE_H } = MONITOR_FACE;
const MONITORS = Object.fromEntries(MONITOR_DESKS.map(room => [room, monitorInteraction(room)])) as Record<MonitorDesk, ReturnType<typeof monitorInteraction>>;

function drawScreen(ctx: CanvasRenderingContext2D, screen: MonitorScreen, accent: string, detailed: boolean) {
  ctx.fillStyle = '#1d2420';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, TEX_W, 8);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const measure = (text: string) => ctx.measureText(text).width;
  if (!detailed) {
    ctx.font = `700 ${overviewFont}px ${PROP_FONT}`;
    monitorOverview(screen).forEach((text, i) => {
      ctx.fillStyle = i === 1 && screen.status ? STATUS_COLORS[screen.status.key] : '#f2f5ed';
      ctx.fillText(canvasTextLines(text, measure, TEX_W - 56, 1)[0] ?? '', 20, 86 + i * 144);
    });
    return;
  }
  ctx.fillStyle = accent;
  ctx.font = `700 44px ${PROP_FONT}`;
  ctx.fillText(canvasTextLines(screen.heading, measure, TEX_W - 56, 1)[0] ?? '', 20, 42);
  ctx.font = `600 36px ${PROP_FONT}`;
  screen.lines.forEach((entry, i) => {
    ctx.fillStyle = LINE_COLORS[entry.kind];
    ctx.fillText(canvasTextLines(entry.text, measure, TEX_W - 56, 1)[0] ?? '', 20, 96 + i * 44);
  });
  if (!screen.status) return;
  ctx.font = `700 40px ${PROP_FONT}`;
  ctx.fillStyle = STATUS_COLORS[screen.status.key];
  ctx.fillText(screen.status.decision, 20, TEX_H - 28);
}

function Screen({ snapshot, room }: { snapshot: OfficeSnapshot; room: MonitorDesk }) {
  const screen = useMemo(() => monitorScreen(snapshot, room), [snapshot, room]);
  const key = monitorScreenKey(screen);
  const [detailed, setDetailed] = useState(false);
  const detail = useRef(false);
  // Observe frames the camera already requests; changing text never starts an animation loop.
  useFrame(({ camera }) => {
    const next = camera.type !== 'OrthographicCamera' || camera.zoom >= 60;
    if (next !== detail.current) { detail.current = next; setDetailed(next); }
  });
  const { center: [x, z], color } = OFFICE_ANCHORS[room];
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawScreen(ctx, screen, color, detailed), [key, color, detailed]);
  const { x: sx, y: sy, z: sz } = MONITOR_FACE;
  return <group name={`prop:monitor:${room}`} position={[x, 0, z]} rotation={[0, room === 'dana' ? Math.PI : 0, 0]}>
    <group position={[sx, sy, sz]} rotation={[0, room === 'dana' ? Math.PI : 0, 0]}>
      <mesh position={[0, 0, 0.059]}>
        <planeGeometry args={[FACE_W, FACE_H]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  </group>;
}

/** Glowing desk screens showing each seat's current task; same transform as mounts/Desks.tsx. */
export function DeskMonitors({ snapshot }: { snapshot: OfficeSnapshot }) {
  return <group name='prop:desk-monitors'>
    {MONITOR_DESKS.filter(room => MONITORS[room].visible(snapshot)).map(room => <Screen key={room} snapshot={snapshot} room={room} />)}
  </group>;
}
