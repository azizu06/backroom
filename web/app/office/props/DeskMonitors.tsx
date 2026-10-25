'use client';

import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { PlaneGeometry } from 'three';
import { OFFICE_ANCHORS, type OfficeSnapshot } from '../../../lib/office/state';
import { MONITOR_DESKS, MONITOR_FACE, MONITOR_TEXTURE, monitorInteraction, monitorOverview, monitorScreen, monitorScreenKey, type MonitorDesk, type MonitorScreen, type MonitorStatusKey } from '../../../lib/office/props/monitors';
import { canvasTextLines } from '../../../lib/office/props/readability';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { PALETTE, ROLES } from '../../../lib/office/palette';

// Text is always navy on the aqua screen (contrast above 4.5:1); the decision colour is a swatch beside it, never the ink.
const STATUS_COLORS: Record<MonitorStatusKey, string> = { allow: PALETTE.mint, deny: ROLES.deny, escalate: PALETTE.butter, recorded: PALETTE.lavender };
const SWATCH_W = 14;
const { width: TEX_W, height: TEX_H, overviewFont } = MONITOR_TEXTURE;
const { width: FACE_W, height: FACE_H } = MONITOR_FACE;
const SCREEN_GEOMETRY = new PlaneGeometry(FACE_W, FACE_H);
const MONITORS = Object.fromEntries(MONITOR_DESKS.map(room => [room, monitorInteraction(room)])) as Record<MonitorDesk, ReturnType<typeof monitorInteraction>>;

function drawScreen(ctx: CanvasRenderingContext2D, screen: MonitorScreen, accent: string, detailed: boolean) {
  ctx.fillStyle = ROLES.screenGlow;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, TEX_W, 8);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const measure = (text: string) => ctx.measureText(text).width;
  if (!detailed) {
    ctx.font = `700 ${overviewFont}px ${PROP_FONT}`;
    monitorOverview(screen).forEach((text, i) => {
      const status = i === 1 && screen.status;
      if (status) { ctx.fillStyle = STATUS_COLORS[status.key]; ctx.fillRect(0, 86 + i * 144 - 44, SWATCH_W, 88); }
      ctx.fillStyle = ROLES.text;
      ctx.fillText(canvasTextLines(text, measure, TEX_W - 56, 1)[0] ?? '', 20 + (status ? SWATCH_W : 0), 86 + i * 144);
    });
    return;
  }
  ctx.fillStyle = ROLES.text;
  ctx.font = `700 44px ${PROP_FONT}`;
  ctx.fillText(canvasTextLines(screen.heading, measure, TEX_W - 56, 1)[0] ?? '', 20, 42);
  ctx.font = `600 36px ${PROP_FONT}`;
  screen.lines.forEach((entry, i) => {
    ctx.fillStyle = ROLES.text;
    ctx.fillText(canvasTextLines(entry.text, measure, TEX_W - 56, 1)[0] ?? '', 20, 96 + i * 44);
  });
  if (!screen.status) return;
  ctx.font = `700 40px ${PROP_FONT}`;
  ctx.fillStyle = STATUS_COLORS[screen.status.key];
  ctx.fillRect(0, TEX_H - 28 - 24, SWATCH_W, 48);
  ctx.fillStyle = ROLES.text;
  ctx.fillText(screen.status.decision, 20 + SWATCH_W, TEX_H - 28);
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
        <primitive object={SCREEN_GEOMETRY} attach='geometry' />
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
