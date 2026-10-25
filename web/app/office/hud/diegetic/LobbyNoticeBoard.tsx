'use client';

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { PlaneGeometry } from 'three';
import { NOTICE_DECISION_COLORS, NOTICE_DECISION_LABELS, noticeBoard, noticeBoardKey, type NoticeBoard } from '../../../../lib/office/hud-diegetic';
import { canvasTextLines } from '../../../../lib/office/props/readability';
import { PALETTE, ROLES } from '../../../../lib/office/palette';
import { visibleRooms } from '../../../../lib/office/state';
import { PROP_FONT, useCanvasTexture } from '../../props/useCanvasTexture';
import type { SceneMountProps } from '../../mounts/types';
import { usePlayCamera } from './usePlayCamera';
import { LOBBY_BOARD_MOUNT } from '../../../../lib/office/layout';

// Same north-wall support as LobbyCounter, painted on its inward (+z) face.
const BOARD = { ...LOBBY_BOARD_MOUNT, z: LOBBY_BOARD_MOUNT.z + LOBBY_BOARD_MOUNT.faceOffset, width: 1.9, height: 1.36 };
const TEX_W = 760, TEX_H = Math.round(TEX_W * BOARD.height / BOARD.width);
const FACE = new PlaneGeometry(BOARD.width, BOARD.height);

function drawBoard(ctx: CanvasRenderingContext2D, board: NoticeBoard) {
  const measure = (text: string) => ctx.measureText(text).width;
  ctx.fillStyle = ROLES.frame;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.cream;
  ctx.font = `800 40px ${PROP_FONT}`;
  ctx.fillText('Today at Backroom', 28, 56);
  if (board.mode) {
    ctx.font = `700 20px ${PROP_FONT}`;
    const w = measure(board.mode) + 28;
    ctx.fillStyle = PALETTE.butter;
    ctx.beginPath(); ctx.roundRect(TEX_W - 28 - w, 30, w, 34, 17); ctx.fill();
    ctx.fillStyle = ROLES.text;
    ctx.fillText(board.mode, TEX_W - 14 - w, 54);
  }
  // Four count tiles.
  const tileW = (TEX_W - 56 - 3 * 14) / 4;
  board.stats.forEach((stat, i) => {
    const x = 28 + i * (tileW + 14);
    ctx.fillStyle = PALETTE.cream;
    ctx.beginPath(); ctx.roundRect(x, 82, tileW, 104, 12); ctx.fill();
    ctx.fillStyle = stat.alert ? (stat.label === 'Denied' ? ROLES.deny : PALETTE.butter) : PALETTE.mint;
    ctx.fillRect(x, 82 + 104 - 10, tileW, 10);
    ctx.fillStyle = ROLES.text;
    ctx.font = `800 48px ${PROP_FONT}`;
    ctx.fillText(String(stat.value), x + 16, 140);
    ctx.font = `600 20px ${PROP_FONT}`;
    ctx.fillText(stat.label, x + 16, 168);
  });
  ctx.fillStyle = PALETTE.cream;
  ctx.font = `800 30px ${PROP_FONT}`;
  ctx.fillText('What happened', 28, 238);
  ctx.fillStyle = PALETTE.slate;
  ctx.fillRect(28, 252, TEX_W - 56, 2);
  if (!board.happened.length) {
    ctx.fillStyle = PALETTE.lavender;
    ctx.font = `500 24px ${PROP_FONT}`;
    ctx.fillText(board.empty, 28, 296);
    ctx.fillText('Each decision lands here and on the audit wall.', 28, 332);
  }
  board.happened.forEach((entry, i) => {
    const y = 268 + i * 66;
    ctx.fillStyle = NOTICE_DECISION_COLORS[entry.decision];
    ctx.beginPath(); ctx.roundRect(28, y + 8, 92, 40, 8); ctx.fill();
    ctx.fillStyle = ROLES.text;
    ctx.font = `800 20px ${PROP_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(NOTICE_DECISION_LABELS[entry.decision], 74, y + 35);
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.cream;
    ctx.font = `500 25px ${PROP_FONT}`;
    ctx.fillText(canvasTextLines(entry.text, measure, TEX_W - 172, 1)[0] ?? '', 138, y + 37);
  });
  ctx.fillStyle = PALETTE.lavender;
  ctx.font = `500 19px ${PROP_FONT}`;
  ctx.fillText('Full receipts: audit wall, west side of the lobby', 28, TEX_H - 20);
}

function Board({ snapshot }: SceneMountProps) {
  const board = useMemo(() => noticeBoard(snapshot), [snapshot]);
  const key = noticeBoardKey(board);
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawBoard(ctx, board), [key]);
  const canvas = useThree(state => state.gl.domElement);
  // Pixels only: mirror the board as a data attribute for tests and tooling.
  useEffect(() => {
    canvas.dataset.noticeBoard = `${board.stats.map(stat => `${stat.label} ${stat.value}`).join(' · ')} | ${board.happened.map(entry => `${entry.decision} ${entry.text}`).join(' · ') || board.empty}`;
    return () => { delete canvas.dataset.noticeBoard; };
  }, [canvas, board]);
  return <mesh name='hud-notice-board' geometry={FACE} position={[BOARD.x, BOARD.y, BOARD.z]}>
    <meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>;
}

/** HUD variant (c): "Today at Backroom" and "What happened" on the lobby board, in Play only. View-only. */
export function LobbyNoticeBoard({ snapshot }: SceneMountProps) {
  const play = usePlayCamera();
  if (!play || !visibleRooms(snapshot).includes('lobby')) return null;
  return <Board snapshot={snapshot} />;
}
