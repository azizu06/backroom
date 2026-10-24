'use client';

import { memo, useMemo } from 'react';
import { Instance, Instances } from '@react-three/drei';
import { OFFICE_ANCHORS, visibleRooms, type OfficeSnapshot } from '../../../lib/office/state';
import {
  DRESSING_INSTANCE_LIMIT, PLANT_FOLIAGE_Y, PLANT_RADIUS, SIGN_DEPTH, SIGN_FACE_HEIGHT, SIGN_FACE_WIDTH,
  dressingBoxes, dressingFor, type Dressing, type DressingPlant, type DressingSign,
} from '../../../lib/office/props/dressing';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

const SIGN_TEX_W = 256, SIGN_TEX_H = 64;

function drawSign(ctx: CanvasRenderingContext2D, text: string, accent: string) {
  ctx.fillStyle = '#303d34';
  ctx.fillRect(0, 0, SIGN_TEX_W, SIGN_TEX_H);
  ctx.fillStyle = accent;
  ctx.fillRect(14, 18, 6, SIGN_TEX_H - 36);
  ctx.fillStyle = '#e7ddc5';
  ctx.font = `600 30px ${PROP_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, SIGN_TEX_W / 2 + 6, SIGN_TEX_H / 2 + 1, SIGN_TEX_W - 44);
}

function Sign({ sign }: { sign: DressingSign }) {
  const accent = OFFICE_ANCHORS[sign.room].color;
  const texture = useCanvasTexture(SIGN_TEX_W, SIGN_TEX_H, ctx => drawSign(ctx, sign.text, accent), [sign.text, accent]);
  const out = SIGN_DEPTH / 2 + 0.002;
  return <mesh position={[sign.x + out * Math.sin(sign.rotationY), sign.y, sign.z + out * Math.cos(sign.rotationY)]} rotation={[0, sign.rotationY, 0]} receiveShadow>
    <planeGeometry args={[SIGN_FACE_WIDTH, SIGN_FACE_HEIGHT]} />
    <meshStandardMaterial map={texture} emissiveMap={texture} emissive='#ffffff' emissiveIntensity={0.3} roughness={1} />
  </mesh>;
}

function Foliage({ plant }: { plant: DressingPlant }) {
  return <mesh position={[plant.x, PLANT_FOLIAGE_Y * plant.size, plant.z]} receiveShadow>
    <dodecahedronGeometry args={[PLANT_RADIUS * plant.size, 0]} /><meshStandardMaterial color='#81936b' />
  </mesh>;
}

const DressingMeshes = memo(function DressingMeshes({ dressing }: { dressing: Dressing }) {
  const boxes = useMemo(() => dressingBoxes(dressing), [dressing]);
  return <group name='prop:dressing'>
    <Instances limit={DRESSING_INSTANCE_LIMIT} castShadow receiveShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={0.9} />
      {boxes.map((box, i) => <Instance key={i} position={box.position} rotation={[0, box.rotationY, 0]} scale={box.size} color={box.color} />)}
    </Instances>
    {dressing.plants.map(plant => <Foliage key={`${plant.x},${plant.z}`} plant={plant} />)}
    {dressing.signs.map(sign => <Sign key={sign.room} sign={sign} />)}
  </group>;
});

/** Decoration only: shelves, plants, doorway plaques and floor route paint. No interaction, no frame loop. */
export function RoomDressing({ snapshot }: { snapshot: OfficeSnapshot }) {
  const rooms = visibleRooms(snapshot).join(',');
  // Rebuilt only when the set of visible rooms changes, not on every snapshot.
  const dressing = useMemo(() => dressingFor(snapshot), [rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  return <DressingMeshes dressing={dressing} />;
}
