import { visibleRooms, type OfficeSnapshot } from '../state';
import type { OfficePropInteraction } from './interact';
import { CORRIDOR } from '../layout';

export interface ClockFace {
  hours: number; minutes: number;
  /** Radians, clockwise from 12. */
  hourAngle: number;
  /** Radians, clockwise from 12. */
  minuteAngle: number;
  /** 'HH:MM', 24h local time. */
  text: string;
}

export function clockFace(now: number): ClockFace {
  const date = new Date(now);
  const hours = date.getHours(), minutes = date.getMinutes();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    hours, minutes,
    hourAngle: ((hours % 12) + minutes / 60) * (Math.PI / 6),
    minuteAngle: minutes * (Math.PI / 30),
    text: `${pad(hours)}:${pad(minutes)}`,
  };
}

/** Milliseconds until the next local minute boundary (always > 0). */
export function msUntilNextMinute(now: number): number {
  return 60_000 - (now % 60_000);
}

/** Solid north corridor wall, west of the Collections doorway. Shared by the visual and interaction. */
export const CLOCK_MOUNT = {
  position: [-10.9, 1.75, CORRIDOR.minZ + 0.1] as [number, number, number],
  radius: 0.65,
  bracketLength: 0.52,
};

/** Visible whenever Lobby or Collections is visible. */
export const CLOCK_INTERACTION: OfficePropInteraction = {
  id: 'clock',
  prompt: 'Check clock',
  position: [CLOCK_MOUNT.position[0], CLOCK_MOUNT.position[2] + CLOCK_MOUNT.bracketLength],
  radius: 1.4,
  visible: snapshot => visibleRooms(snapshot).some(room => room === 'lobby' || room === 'collections'),
  panel(snapshot, now) {
    return {
      title: 'Wall clock',
      rows: [
        { label: 'Time', value: clockFace(now).text },
        { label: 'Audit receipts', value: String(snapshot.audit.length) },
      ],
    };
  },
};
