'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { needsHandoffHuman } from '../../lib/office/handoffs';
import { useHandoffPresentation } from './handoffs/HandoffPresentation';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { OrthographicCamera, type PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import { REDUCED_MOTION_QUERY } from '../../lib/office/a11y';
import { interpolateIntroPose, playIntroProgress, type IntroPose } from '../../lib/office/play-intro';
import type { MotionRegistry } from '../../lib/office/motion';
import { BASE_FOV, INITIAL_FEEL, advanceFeel, effectiveFeel, integrateVelocity, type FeelState } from '../../lib/office/playFeel';
import { playOfficeCue } from '../../lib/office/sound-events';
import {
  EYE_HEIGHT, PLAYER_RADIUS, SERVER_ROOM_BOX, SPAWN, applyLook, interactCandidates, moveIntent, movePlayer, officeColliders,
  frameLookYaw, pickTarget, targetKey, turnIntent, type PlayBridge, type PlayTarget,
} from '../../lib/office/play';
import { playSpawn } from '../../lib/office/play-spawn';
import { useImmersiveRig } from './immersive/rig';
import { interactionStore } from '../../lib/office/interactions';
import { bakedArtRequested } from '../../lib/office/baked-art';
import { LOBBY_PROP_BOXES, lobbyCollisionExtras } from '../../lib/office/baked-colliders';
import { visibleRooms, type OfficeSnapshot } from '../../lib/office/state';

function playEye([x, z]: readonly [number, number]): IntroPose {
  return { position: [x, EYE_HEIGHT, z], quaternion: [0, Math.sin(SPAWN.yaw / 2), 0, Math.cos(SPAWN.yaw / 2)] };
}

/**
 * First-person camera for Play. Replaces CameraRig while mounted; unmounting restores the
 * orthographic default camera. Frames continue only during the intro or while input is active.
 */
export function PlayRig({ input, motions, snapshot, onTarget, hud, coworkers }: PlayBridge & { motions: MotionRegistry; snapshot: OfficeSnapshot }) {
  const handoffs = useHandoffPresentation()?.stage;
  const camera = useRef<ThreePerspectiveCamera>(null);
  const invalidate = useThree(state => state.invalidate);
  const get = useThree(state => state.get);
  // The camera before Play (read before PerspectiveCamera makes itself the default).
  const [previous] = useState(() => get().camera);
  // The rig owns the camera/input handoff; scene mounts only receive the snapshot.
  const [intro] = useState(() => ({
    from: { position: previous.position.toArray(), quaternion: previous.quaternion.toArray() } satisfies IntroPose,
    startedAt: null as number | null, done: false,
  }));
  const yaw = useRef<number>(SPAWN.yaw);
  const pitch = useRef(0);
  const feel = useRef<FeelState>(INITIAL_FEEL);
  const velocity = useRef<[number, number]>([0, 0]);
  const fov = useRef(BASE_FOV);
  const immersive = useImmersiveRig();
  const wasActive = useRef(false);
  const feelSettling = useRef(false);
  const written = useRef(false);
  const target = useRef('');
  const reduced = useRef(window.matchMedia(REDUCED_MOTION_QUERY).matches);
  const rooms = visibleRooms(snapshot);
  const roomsKey = rooms.join(',');
  // Refresh movement barriers immediately when a viewer opens or closes a cosmetic door.
  const local = useSyncExternalStore(interactionStore.subscribe, interactionStore.getSnapshot, interactionStore.getServerSnapshot);
  // Bundled footprints; appended only for ?art=baked so the default collision set is unchanged.
  const baked = useMemo(() => bakedArtRequested(location.search), []);
  const colliders = useMemo(
    () => officeColliders(rooms, lobbyCollisionExtras(baked, LOBBY_PROP_BOXES, [SERVER_ROOM_BOX]), local.doors),
    [roomsKey, baked, local.doors],
  );
  const [spawn] = useState(() => playSpawn(location.search, colliders));
  const [eye] = useState(() => playEye(spawn));
  const position = useRef<[number, number]>(spawn);
  const latest = useRef({ snapshot, colliders, onTarget });
  latest.current = { snapshot, colliders, onTarget };

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => { reduced.current = query.matches; invalidate(); };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [invalidate]);
  useEffect(() => () => { latest.current.onTarget(null); }, []);
  // The canvas only resizes the active camera; refit the restored orthographic one in case it resized during Play.
  useEffect(() => () => {
    if (!(previous instanceof OrthographicCamera)) return;
    const { width, height } = get().size;
    previous.left = -width / 2; previous.right = width / 2; previous.top = height / 2; previous.bottom = -height / 2;
    previous.updateProjectionMatrix();
    invalidate();
  }, [previous, get, invalidate]);

  useFrame((state, delta) => {
    if (!camera.current) return;
    if (!intro.done) {
      const now = performance.now();
      intro.startedAt ??= now;
      const progress = playIntroProgress(now - intro.startedAt, reduced.current);
      const pose = interpolateIntroPose(intro.from, eye, progress);
      camera.current.position.fromArray(pose.position);
      camera.current.quaternion.fromArray(pose.quaternion);
      camera.current.updateMatrixWorld();
      if (progress < 1) {
        input.consumeLook();
        input.consumeTurnTap();
        state.invalidate();
        return;
      }
      intro.done = true;
    }
    const flags = effectiveFeel(input.feel, reduced.current);
    const coasting = velocity.current[0] !== 0 || velocity.current[1] !== 0 || feelSettling.current || immersive.settling;
    const active = input.active() || coasting;
    // The first frame after idle has a stale clock delta; treat it as one display frame.
    const dt = wasActive.current ? Math.min(delta, 0.1) : 1 / 60;
    wasActive.current = active;
    const [lookYaw, lookPitch] = input.consumeLook();
    immersive.damp(lookYaw, lookPitch, dt, flags.smoothing);
    const look = applyLook(yaw.current, pitch.current, frameLookYaw(immersive.yaw, turnIntent(input, dt), input.consumeTurnTap()), immersive.pitch);
    const turned = look.yaw !== yaw.current || look.pitch !== pitch.current;
    yaw.current = look.yaw;
    pitch.current = look.pitch;
    // moveIntent at dt = 1 is the wanted velocity in m/s; the velocity eases toward it (or snaps, without smoothing).
    const wish = moveIntent(input, yaw.current, 1);
    const wanted = integrateVelocity(velocity.current, wish, dt, flags.smoothing);
    const next = movePlayer(position.current, [wanted[0] * dt, wanted[1] * dt], latest.current.colliders, PLAYER_RADIUS);
    const travelled = Math.hypot(next[0] - position.current[0], next[1] - position.current[1]);
    const moved = travelled > 0;
    // A wall absorbs the speed it stopped: keep only what actually moved, so sliding along it stays smooth.
    const wantedStep = Math.hypot(wanted[0], wanted[1]) * dt;
    velocity.current = travelled < wantedStep - 1e-6 ? [(next[0] - position.current[0]) / dt, (next[1] - position.current[1]) / dt] : wanted;
    position.current = next;
    const frame = advanceFeel(feel.current, { speed: travelled / dt, travelled, dt, flags });
    feel.current = frame.state;
    feelSettling.current = frame.settling;
    if (frame.steps > 0) { immersive.step(travelled / dt); playOfficeCue('step'); }
    if (camera.current) {
      if (Math.abs(camera.current.fov - frame.fov) > 1e-3) {
        camera.current.fov = frame.fov;
        camera.current.updateProjectionMatrix();
      }
      fov.current = frame.fov;
      immersive.pose(camera.current, next[0], EYE_HEIGHT + frame.bobY, next[1], yaw.current, pitch.current, feel.current.distance, feel.current.bob);
    }
    const { snapshot: current, onTarget: report } = latest.current;
    const agents = current.agents.map(agent => ({ id: agent.id, position: motions.get(agent).position }));
    const handoff = handoffs?.sample(Date.now(), reduced.current);
    // Only agents with a handoff to show are targets (Dana only while she is at her desk).
    const handoffAgents = handoff ? handoff.actors.filter(actor => (actor.id !== 'human' || handoff.human)
      && handoffs!.current.some(row => row.fromRole === actor.id || row.toRole === actor.id || (actor.id === 'human' && needsHandoffHuman(row)))) : [];
    const picked: PlayTarget | null = pickTarget(next, yaw.current, interactCandidates(agents, visibleRooms(current), coworkers?.current, handoffAgents));
    const key = targetKey(picked);
    if (key !== target.current) { target.current = key; report(picked); }
    if (hud.current && (moved || turned || !written.current)) {
      written.current = true;
      hud.current.dataset.playerX = next[0].toFixed(3);
      hud.current.dataset.playerZ = next[1].toFixed(3);
      hud.current.dataset.playerYaw = yaw.current.toFixed(3);
    }
    const fovText = fov.current.toFixed(2);
    if (hud.current && hud.current.dataset.playerFov !== fovText) hud.current.dataset.playerFov = fovText;
    if (active) state.invalidate();
  }, -1);

  useEffect(() => { invalidate(); }, [invalidate]);
  return <PerspectiveCamera ref={camera} makeDefault fov={BASE_FOV} near={0.05} />;
}
