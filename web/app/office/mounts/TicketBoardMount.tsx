'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { TICKET_BOARD, TICKET_BOARD_TEXTURE } from '../../../lib/office/props/ticketBoard';
import { canvasTextLines } from '../../../lib/office/props/readability';
import { ticketBoard, ticketBoardKey, ticketBoardText, type TicketBoardModel } from '../../../lib/office/ticket-board';
import { PROP_FONT } from '../props/useCanvasTexture';
import { useSceneTextNode } from '../props/useSceneTextNode';
import type { SceneMountProps } from './types';

function drawBoard(ctx: CanvasRenderingContext2D, model: TicketBoardModel) {
  const { width, height, minFont } = TICKET_BOARD_TEXTURE;
  ctx.fillStyle = ROLES.background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ROLES.text;
  ctx.font = `bold 52px ${PROP_FONT}`;
  ctx.fillText('Tickets · agent tasks', 28, 58);
  ctx.font = `${minFont}px ${PROP_FONT}`;
  ctx.textAlign = 'right';
  canvasTextLines(model.notice ?? 'Open tickets · E when nearby', text => ctx.measureText(text).width, 560, 2)
    .forEach((line, index) => ctx.fillText(line, width - 28, 34 + index * 34));
  ctx.textAlign = 'left';
  const columnWidth = (width - 48) / 4;
  model.columns.forEach((column, index) => {
    const x = 24 + index * columnWidth;
    ctx.fillStyle = column.id === 'needs-you' ? ROLES.statusWarn : column.id === 'done' ? ROLES.statusOk : PALETTE.lavender;
    ctx.fillRect(x, 80, columnWidth - 12, 56);
    ctx.fillStyle = ROLES.text;
    ctx.font = `bold 38px ${PROP_FONT}`;
    ctx.fillText(`${column.name} · ${column.count}`, x + 12, 120);
    column.cards.forEach((card, row) => {
      const y = 148 + row * 138;
      ctx.fillStyle = card.rejected ? PALETTE.blush : column.id === 'needs-you' ? ROLES.statusWarn : PALETTE.cream;
      ctx.fillRect(x, y, columnWidth - 12, 130);
      ctx.strokeStyle = card.rejected ? ROLES.deny : ROLES.shadow;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, columnWidth - 12, 130);
      ctx.fillStyle = card.rejected ? ROLES.deny : ROLES.text;
      ctx.font = `bold ${minFont}px ${PROP_FONT}`;
      const measure = (text: string) => ctx.measureText(text).width;
      const id = canvasTextLines(card.caseDisplayId, measure, 248, 1)[0] ?? '';
      ctx.fillText(id, x + 12, y + 30);
      if (card.rejected) {
        ctx.beginPath(); ctx.moveTo(x + 12, y + 19); ctx.lineTo(x + 12 + measure(id), y + 19); ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.fillText(card.tag, x + columnWidth - 24, y + 30);
      ctx.textAlign = 'left';
      ctx.font = `${minFont}px ${PROP_FONT}`;
      canvasTextLines(card.summary, measure, columnWidth - 36, 2)
        .forEach((line, lineIndex) => ctx.fillText(line, x + 12, y + 62 + lineIndex * 32));
      ctx.fillStyle = card.color;
      ctx.fillRect(x + 12, y + 104, 16, 16);
      ctx.fillStyle = ROLES.text;
      ctx.fillText(canvasTextLines(card.agent, measure, columnWidth - 62, 1)[0] ?? '', x + 38, y + 123);
    });
    if (column.more) {
      ctx.fillStyle = ROLES.text;
      ctx.font = `${minFont}px ${PROP_FONT}`;
      ctx.fillText(`+${column.more} more`, x + 12, height - 18);
    }
  });
  if (model.empty) {
    ctx.fillStyle = ROLES.text;
    ctx.font = `bold 52px ${PROP_FONT}`;
    ctx.textAlign = 'center'; ctx.fillText('No tickets yet', width / 2, height / 2); ctx.textAlign = 'left';
  }
}

export function TicketBoardMount({ snapshot }: SceneMountProps) {
  const model = useMemo(() => ticketBoard(snapshot), [snapshot]);
  const key = ticketBoardKey(model);
  const text = ticketBoardText(model);
  const invalidate = useThree(state => state.invalidate);
  const canvas = useThree(state => state.gl.domElement);
  // The shared prop helper caps at 1024; this five-metre board needs one explicit 2048 backing store.
  const [texture] = useState(() => {
    const image = document.createElement('canvas');
    image.width = TICKET_BOARD_TEXTURE.width; image.height = TICKET_BOARD_TEXTURE.height;
    const result = new CanvasTexture(image);
    result.colorSpace = SRGBColorSpace; result.anisotropy = 4;
    return result;
  });
  useLayoutEffect(() => {
    const ctx = (texture.image as HTMLCanvasElement).getContext('2d');
    if (ctx) { drawBoard(ctx, JSON.parse(key) as TicketBoardModel); texture.needsUpdate = true; invalidate(); }
  }, [texture, key, invalidate]);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  useSceneTextNode('ticket-board', `Tickets · agent tasks\n${text}`);
  useEffect(() => {
    canvas.dataset.ticketBoard = text;
    return () => { delete canvas.dataset.ticketBoard; };
  }, [canvas, text]);
  const { x, z, width, height, bottom, depth, faceWidth, faceHeight } = TICKET_BOARD;
  return <group name='mount:ticket-board' position={[x, bottom + height / 2, z]} rotation={[0, TICKET_BOARD.rotationY, 0]}>
    <mesh receiveShadow>
      <boxGeometry args={[width, height, depth]} /><meshStandardMaterial color={ROLES.frame} roughness={0.8} />
    </mesh>
    <mesh position={[0, 0, depth / 2 + 0.001]}>
      <planeGeometry args={[faceWidth, faceHeight]} /><meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  </group>;
}
