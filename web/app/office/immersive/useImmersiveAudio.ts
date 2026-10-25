'use client';

import { useEffect, type RefObject } from 'react';
import { floorFor, spaceAt, windowNearness, type Space } from '../../../lib/office/immersive/spaces';
import { OFFICE_SOUND_EVENT } from '../../../lib/office/sound-events';
import { soundPreference } from '../../../lib/office/sound';
import { visibleRooms, type AnchorId, type OfficeSnapshot } from '../../../lib/office/state';
import { ImmersiveAudioEngine } from './audio-engine';
import { immersiveChannel } from './channel';

/**
 * Room-aware procedural ambience and floor-aware footsteps while Play is mounted. Silent until the viewer
 * has clicked on the page and only while the existing Sound toggle is on: every trusted click re-reads the
 * toggle's saved preference (the toggle's own handler runs first), so turning sound off stops it at once.
 * The space is read from the rig's pose on the Play surface, like the room-entry label.
 */
export function useImmersiveAudio(hud: RefObject<HTMLElement | null>, snapshot: OfficeSnapshot): void {
  const roomsKey = visibleRooms(snapshot).join(',');

  useEffect(() => {
    const surface = hud.current;
    if (!surface) return;
    const rooms = roomsKey ? roomsKey.split(',') as AnchorId[] : [];
    const engine = new ImmersiveAudioEngine();
    let room: AnchorId | null = null;
    let space: Space = 'aisle';

    const syncOwner = () => { immersiveChannel.footsteps = engine.running; };
    const sync = () => {
      if (soundPreference() === 'on') engine.enable();
      else engine.disable();
      syncOwner();
      // A fresh context starts suspended for a moment; check again once it is running.
      window.setTimeout(syncOwner, 120);
    };
    const click = (event: MouseEvent) => { if (event.isTrusted) sync(); };
    const readPose = () => {
      const { playerX, playerZ } = surface.dataset;
      if (playerX === undefined || playerZ === undefined) return;
      const x = Number(playerX), z = Number(playerZ);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const reading = spaceAt([x, z], room, rooms);
      room = reading.room; space = reading.space;
      engine.setSpace(space, windowNearness([x, z]));
    };
    const cue = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail !== 'step') return;
      syncOwner();
      engine.footstep(floorFor(space), immersiveChannel.speed);
    };

    readPose();
    // Restoring an "on" toggle waits for a click in Play: keyboard activation must not start audio.
    const observer = new MutationObserver(readPose);
    observer.observe(surface, { attributes: true, attributeFilter: ['data-player-x', 'data-player-z'] });
    window.addEventListener('click', click);
    window.addEventListener(OFFICE_SOUND_EVENT, cue);
    return () => {
      observer.disconnect();
      window.removeEventListener('click', click);
      window.removeEventListener(OFFICE_SOUND_EVENT, cue);
      engine.disable();
      immersiveChannel.footsteps = false;
    };
  }, [hud, roomsKey]);
}
