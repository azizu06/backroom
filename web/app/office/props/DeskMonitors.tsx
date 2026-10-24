'use client';

import { useMemo } from 'react';
import { OFFICE_ANCHORS, type OfficeSnapshot } from '../../../lib/office/state';
import { MONITOR_DESKS, monitorInteraction, monitorScreen, monitorScreenKey, type MonitorDesk, type MonitorScreen, type MonitorStatusKey } from '../../../lib/office/props/monitors';
import { useCanvasTexture } from './useCanvasTexture';

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const STATUS_COLORS: Record<MonitorStatusKey, string> = { allow: '#a9bc8f', deny: '#ed6252', escalate: '#e0b365', recorded: '#8c9c87' };
const LINE_COLORS = { agent: '#e8efe4', away: '#c9d4c3', folder: '#e0b365', idle: '#7f8c80', awaiting: '#e8efe4', escalation: '#c9d4c3' } as const;
const TEX_W = 256, TEX_H = 144, FACE_W = 0.66, FACE_H = 0.36;
/** Desk-local screen spot: 1-2 mm in front of whatever face scene.tsx draws at z -0.18 (+0.0075 half depth). */
const SCREEN_AT = [-0.35, 1.18, -0.165] as const;
const MONITORS = Object.fromEntries(MONITOR_DESKS.map(room => [room, monitorInteraction(room)])) as Record<MonitorDesk, ReturnType<typeof monitorInteraction>>;

function drawScreen(ctx: CanvasRenderingContext2D, screen: MonitorScreen, accent: string) {
  ctx.fillStyle = '#1d2420';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, TEX_W, 6);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  ctx.font = `700 16px ${MONO_FONT}`;
  ctx.fillText(screen.heading, 10, 27);
  ctx.font = `500 13px ${MONO_FONT}`;
  screen.lines.forEach((entry, i) => {
    ctx.fillStyle = LINE_COLORS[entry.kind];
    ctx.fillText(entry.text, 10, 50 + i * 19, TEX_W - 20);
  });
  if (!screen.status) return;
  const label = screen.status.decision, color = STATUS_COLORS[screen.status.key];
  ctx.font = `700 11px ${MONO_FONT}`;
  const width = ctx.measureText(label).width + 16, x = TEX_W - 10 - width, y = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#1d2420';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + width / 2, y + 13);
}

function Screen({ snapshot, room }: { snapshot: OfficeSnapshot; room: MonitorDesk }) {
  const screen = useMemo(() => monitorScreen(snapshot, room), [snapshot, room]);
  const key = monitorScreenKey(screen);
  const { center: [x, z], color } = OFFICE_ANCHORS[room];
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawScreen(ctx, screen, color), [key, color]);
  return <group name={`prop:monitor:${room}`} position={[x, 0, z]} rotation={[0, room === 'dana' ? Math.PI : 0, 0]}>
    <mesh position={SCREEN_AT}>
      <planeGeometry args={[FACE_W, FACE_H]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  </group>;
}

/** Glowing desk screens showing each seat's current task; same transform as scene.tsx `Desk`. */
export function DeskMonitors({ snapshot }: { snapshot: OfficeSnapshot }) {
  return <group name='prop:desk-monitors'>
    {MONITOR_DESKS.filter(room => MONITORS[room].visible(snapshot)).map(room => <Screen key={room} snapshot={snapshot} room={room} />)}
  </group>;
}
