'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { ACESFilmicToneMapping, MeshStandardMaterial } from 'three';
import { LOW_POWER_QUERY, OFFICE_LAMPS, OFFICE_EXPOSURE, lampPieces, officeLightRig, officeLowPower } from '../../lib/office/lighting';
import { ROLES } from '../../lib/office/palette';
import { visibleRooms, type OfficeSnapshot } from '../../lib/office/state';
import type { FurniturePiece } from '../../lib/office/furniture';
import { StaticBoxes, StaticInstances, UNIT_BOX } from './mounts/StaticGeometry';
import { useBakedLobbyReady } from './mounts/BakedArt';
import { bakedReplacesProps } from '../../lib/office/baked-art';
import { OfficeContactShadows } from './ContactShadows';

export const OFFICE_RENDERER = { antialias: true, powerPreference: 'high-performance' as const,
  toneMapping: ACESFilmicToneMapping, toneMappingExposure: OFFICE_EXPOSURE };

type SavingConnection = EventTarget & { saveData?: boolean };
const connection = () => (navigator as Navigator & { connection?: SavingConnection }).connection;
function subscribeLowPower(onChange: () => void) {
  const query = window.matchMedia(LOW_POWER_QUERY);
  const network = connection();
  query.addEventListener('change', onChange);
  network?.addEventListener('change', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    query.removeEventListener('change', onChange);
    network?.removeEventListener('change', onChange);
    window.removeEventListener('popstate', onChange);
  };
}
export function useOfficeLowPower() {
  return useSyncExternalStore(subscribeLowPower,
    () => officeLowPower(window.location.search, window.matchMedia(LOW_POWER_QUERY).matches, connection()?.saveData), () => false);
}

// Shared with the lazy scene's lifetime. Emissive shades stay warm even with lamp pools disabled.
const SHADE_MATERIAL = new MeshStandardMaterial({ color: ROLES.lampLight, emissive: ROLES.lampLight,
  emissiveIntensity: 0.65, roughness: 0.9 });

/** Two static geometry batches, no shadow-casting lamp geometry and no animation subscriptions. */
function Lamps({ rooms }: { rooms: string }) {
  const baked = useBakedLobbyReady();
  const { bodies, shades } = useMemo(() => {
    const bodies: FurniturePiece[] = [], shades: FurniturePiece[] = [];
    // Under ?art=baked the baked room brings its own lamp, so the procedural one would stand inside it.
    for (const lamp of OFFICE_LAMPS.filter(lamp => rooms.split(',').includes(lamp.room) && !bakedReplacesProps(baked, lamp.room))) {
      const [base, stem, shade] = lampPieces(lamp);
      bodies.push(base!, stem!);
      shades.push(shade!);
    }
    return { bodies, shades };
  }, [rooms, baked]);
  if (!bodies.length) return null;
  return <group name='office:lamps'>
    <StaticBoxes pieces={bodies} castShadow={false} />
    <StaticInstances pieces={shades} geometry={UNIT_BOX} material={SHADE_MATERIAL} castShadow={false} />
  </group>;
}

export function OfficeLights({ snapshot, lowPower }: { snapshot: OfficeSnapshot; lowPower: boolean }) {
  const { key, fill, hemisphere, pointLights, ceilingFill, contactShadows } = officeLightRig(lowPower);
  const rooms = visibleRooms(snapshot);
  const baked = useBakedLobbyReady();
  return <>
    <hemisphereLight args={[hemisphere.skyColor, hemisphere.groundColor, hemisphere.intensity]} />
    <directionalLight position={key.position} color={key.color} intensity={key.intensity} castShadow={key.castShadow}
      shadow-mapSize={[key.shadow.mapSize, key.shadow.mapSize]} shadow-bias={key.shadow.bias}
      shadow-camera-near={key.shadow.near} shadow-camera-far={key.shadow.far}
      shadow-camera-left={key.shadow.left} shadow-camera-right={key.shadow.right} shadow-camera-top={key.shadow.top} shadow-camera-bottom={key.shadow.bottom} />
    <directionalLight position={fill.position} color={fill.color} intensity={fill.intensity} castShadow={fill.castShadow} />
    {pointLights.filter(light => rooms.includes(light.room)).map(({ room, ...light }) => <pointLight key={room} {...light} />)}
    {ceilingFill && <pointLight name='office:ceiling-fill' {...ceilingFill} />}
    {/* Demand frames only; dropping this pass entirely is essential in low-power mode. Static casters bake once per room set. */}
    {contactShadows && <OfficeContactShadows config={contactShadows} version={`${rooms.join(',')}|${baked}`} />}
    <Lamps rooms={rooms.join(',')} />
  </>;
}
