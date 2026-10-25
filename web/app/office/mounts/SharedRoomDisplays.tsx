'use client';

import { OUTDOOR, PALETTE, ROLES } from '../../../lib/office/palette';
import { PROP_FONT, useCanvasTexture } from '../props/useCanvasTexture';

export function drawMeetingAgenda(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = OUTDOOR.screen;
  ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = PALETTE.aqua;
  ctx.font = `bold 46px ${PROP_FONT}`;
  ctx.fillText('Backroom', 32, 70);
  ctx.fillStyle = PALETTE.cream;
  ctx.font = `24px ${PROP_FONT}`;
  ['TEAM SYNC', '01  Review the inbox', '02  Resolve approvals', '03  Next steps'].forEach((line, i) => ctx.fillText(line, 32, 120 + i * 44));
}

export function drawMeetingWhiteboard(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PALETTE.cream;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = ROLES.text;
  ctx.fillStyle = ROLES.text;
  ctx.lineWidth = 4;
  ctx.font = `22px ${PROP_FONT}`;
  ['Inbox', 'Review', 'Done'].forEach((label, i) => {
    const x = 20 + i * 170;
    ctx.strokeRect(x, 90 + i * 6, 125, 65);
    ctx.fillText(label, x + 12, 130 + i * 6);
    if (i === 2) return;
    ctx.beginPath();
    ctx.moveTo(x + 130, 125 + i * 6);
    ctx.lineTo(x + 165, 125 + i * 6);
    ctx.lineTo(x + 155, 115 + i * 6);
    ctx.moveTo(x + 165, 125 + i * 6);
    ctx.lineTo(x + 155, 135 + i * 6);
    ctx.stroke();
  });
  ctx.fillStyle = PALETTE.coral;
  ctx.font = `26px ${PROP_FONT}`;
  ctx.fillText('Plan → act → reconcile', 32, 48);
}

/** Local canvas text avoids font or image downloads. Textures dispose through the shared hook. */
export function SharedRoomDisplays() {
  const agenda = useCanvasTexture(512, 288, drawMeetingAgenda, []);
  const whiteboard = useCanvasTexture(512, 256, drawMeetingWhiteboard, []);
  return <group name='meeting-displays'>
    <mesh position={[9, 1.55, -7.35]}>
      <planeGeometry args={[1.68, 0.93]} />
      <meshBasicMaterial map={agenda} toneMapped={false} />
    </mesh>
    <mesh position={[6.185, 1.65, -4.8]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[2, 1]} />
      <meshBasicMaterial map={whiteboard} toneMapped={false} />
    </mesh>
  </group>;
}
