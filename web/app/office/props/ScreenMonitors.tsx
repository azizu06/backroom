'use client';

import { useSyncExternalStore } from 'react';
import { PlaneGeometry } from 'three';
import { WORKSTATIONS } from '../../../lib/office/layout';
import { MONITOR_FACE } from '../../../lib/office/props/monitors';
import { screenStore, type ScreenSeat } from '../../../lib/office/screens';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

const TEX_W = 640, TEX_H = 384;
const GEOMETRY = new PlaneGeometry(MONITOR_FACE.width, MONITOR_FACE.height);

/** One shared desk's monitor: the live image when you are near enough to receive it, otherwise who is sharing. */
function SharedScreen({ seat, frame }: { seat: ScreenSeat; frame: number | undefined }) {
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => {
    ctx.fillStyle = '#10151d';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    const image = frame ? screenStore.image(seat.desk) : undefined;
    if (image) {
      const scale = Math.min(TEX_W / image.width, TEX_H / image.height);
      const w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, (TEX_W - w) / 2, (TEX_H - h) / 2, w, h);
      return;
    }
    ctx.fillStyle = '#e8eef5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 46px ${PROP_FONT}`;
    ctx.fillText(`${seat.name} is sharing`, TEX_W / 2, TEX_H / 2 - 30);
    ctx.font = `500 30px ${PROP_FONT}`;
    ctx.fillText('Walk over to watch', TEX_W / 2, TEX_H / 2 + 34);
  }, [seat.name, frame]);
  const { center: [x, z], flip } = WORKSTATIONS[seat.desk]!;
  return <group name={`prop:shared-screen:${seat.desk}`} position={[x, 0, z]} rotation={[0, flip === -1 ? Math.PI : 0, 0]}>
    <mesh position={[MONITOR_FACE.x, MONITOR_FACE.y, MONITOR_FACE.z + 0.06]}>
      <primitive object={GEOMETRY} attach='geometry' />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  </group>;
}

/** Shared screens on open desks (useScreenShare fills the store). */
export function ScreenMonitors() {
  const state = useSyncExternalStore(screenStore.subscribe, screenStore.getSnapshot, screenStore.getServerSnapshot);
  return <group name='prop:shared-screens'>
    {state.seats.filter(seat => seat.viewerId !== state.selfId).map(seat => <SharedScreen key={`${seat.desk}:${seat.viewerId}`} seat={seat} frame={state.frames[seat.desk]} />)}
  </group>;
}
