import { visibleRooms, type OfficeSnapshot } from '../state';
import type { OfficePropInteraction } from './interact';

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

/**
 * Hangs on the corridor's west end wall between Lobby and Collections,
 * so it is visible whenever either of those rooms is visible.
 */
export const CLOCK_INTERACTION: OfficePropInteraction = {
  id: 'clock',
  prompt: 'Check clock',
  position: [-11.5, 0],
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
