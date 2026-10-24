'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { OrthographicCamera, type PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import { REDUCED_MOTION_QUERY } from '../../lib/office/a11y';
import { interpolateIntroPose, playIntroProgress, type IntroPose } from '../../lib/office/play-intro';
import type { MotionRegistry } from '../../lib/office/motion';
import {
  EYE_HEIGHT, PLAYER_RADIUS, SERVER_ROOM_BOX, SPAWN, applyLook, headBob, interactCandidates, moveIntent, movePlayer, officeColliders,
  pickTarget, targetKey, turnIntent, type PlayBridge, type PlayTarget,
} from '../../lib/office/play';
import { visibleRooms, type OfficeSnapshot } from '../../lib/office/state';
import { dressingColliders } from '../../lib/office/props/dressing';

const PLAY_EYE: IntroPose = {
  position: [SPAWN.position[0], EYE_HEIGHT, SPAWN.position[1]],
  quaternion: [0, Math.sin(SPAWN.yaw / 2), 0, Math.cos(SPAWN.yaw / 2)],
};

/**
 * First-person camera for Play. Replaces CameraRig while mounted; unmounting restores the
 * orthographic default camera. Frames continue only during the intro or while input is active.
 */
export function PlayRig({ input, motions, snapshot, onTarget, hud }: PlayBridge & { motions: MotionRegistry; snapshot: OfficeSnapshot }) {
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
  const position = useRef<[number, number]>([SPAWN.position[0], SPAWN.position[1]]);
  const yaw = useRef<number>(SPAWN.yaw);
  const pitch = useRef(0);
  const walked = useRef(0);
  const wasActive = useRef(false);
  const written = useRef(false);
  const target = useRef('');
  const reduced = useRef(window.matchMedia(REDUCED_MOTION_QUERY).matches);
  const rooms = visibleRooms(snapshot);
  const roomsKey = rooms.join(',');
  const colliders = useMemo(() => officeColliders(rooms, [SERVER_ROOM_BOX, ...dressingColliders(rooms)]), [roomsKey]);
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
      const pose = interpolateIntroPose(intro.from, PLAY_EYE, progress);
      camera.current.position.fromArray(pose.position);
      camera.current.quaternion.fromArray(pose.quaternion);
      camera.current.updateMatrixWorld();
      if (progress < 1) {
        input.consumeLook();
        state.invalidate();
        return;
      }
      intro.done = true;
    }
    const active = input.active();
    // The first frame after idle has a stale clock delta; treat it as one display frame.
    const dt = wasActive.current ? Math.min(delta, 0.1) : 1 / 60;
    wasActive.current = active;
    const [lookYaw, lookPitch] = input.consumeLook();
    const look = applyLook(yaw.current, pitch.current, lookYaw + turnIntent(input, dt), lookPitch);
    const turned = look.yaw !== yaw.current || look.pitch !== pitch.current;
    yaw.current = look.yaw;
    pitch.current = look.pitch;
    const step = moveIntent(input, yaw.current, dt);
    const next = movePlayer(position.current, step, latest.current.colliders, PLAYER_RADIUS);
    const travelled = Math.hypot(next[0] - position.current[0], next[1] - position.current[1]);
    const moved = travelled > 0;
    walked.current += travelled;
    position.current = next;
    if (camera.current) {
      camera.current.position.set(next[0], EYE_HEIGHT + headBob(walked.current, moved, reduced.current), next[1]);
      camera.current.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
      camera.current.updateMatrixWorld();
    }
    const { snapshot: current, onTarget: report } = latest.current;
    const agents = current.agents.map(agent => ({ id: agent.id, position: motions.get(agent).position }));
    const picked: PlayTarget | null = pickTarget(next, yaw.current, interactCandidates(agents, visibleRooms(current), current));
    const key = targetKey(picked);
    if (key !== target.current) { target.current = key; report(picked); }
    if (hud.current && (moved || turned || !written.current)) {
      written.current = true;
      hud.current.dataset.playerX = next[0].toFixed(3);
      hud.current.dataset.playerZ = next[1].toFixed(3);
      hud.current.dataset.playerYaw = yaw.current.toFixed(3);
    }
    if (active) state.invalidate();
  }, -1);

  useEffect(() => { invalidate(); }, [invalidate]);
  return <PerspectiveCamera ref={camera} makeDefault fov={70} near={0.05} />;
}
