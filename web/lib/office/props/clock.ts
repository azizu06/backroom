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
