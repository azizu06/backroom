import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAgent, type OfficeAudit, type OfficeSnapshot, type SeatId } from '../state';
import {
  AMBIENT_FPS, CURSOR_SIZE, GLOW_MEAN, GLOW_PERIOD, IDLE_BUSY, SWAY_MAX, ambientActive, ambientDesks, busyLevel, cursorBlink, cursorPoint, plantSway, screenGlow,
} from './ambient';
import { MONITOR_MAX_LINES } from './monitors';

const snapshot = (patch: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, connection: 'preview', ...patch });
const agent = (seatId: SeatId, targetAnchor: OfficeAgent['targetAnchor'] = seatId): OfficeAgent =>
  ({ id: `${seatId}-clerk`, name: seatId, seatId, targetAnchor, pos: OFFICE_ANCHORS[seatId].position, state: 'idle' });
const row = (id: string, seatId: string): OfficeAudit =>
  ({ id, agentId: `${seatId}-clerk`, seatId, action: 'note', decision: 'RECORDED', ruleIds: [], summary: id });
const samples = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('ambientActive', () => {
  it('runs for preview and live, and stops for reduced motion, a hidden tab or replay', () => {
    expect(AMBIENT_FPS).toBeGreaterThan(0);
    expect(AMBIENT_FPS).toBeLessThanOrEqual(10);
    for (const connection of ['preview', 'live', 'connecting', 'disconnected'] as const) expect(ambientActive(snapshot({ connection }), false, false)).toBe(true);
    expect(ambientActive(snapshot(), true, false)).toBe(false);
    expect(ambientActive(snapshot(), false, true)).toBe(false);
    expect(ambientActive(snapshot({ connection: 'replay' }), false, false)).toBe(false);
  });
});

describe('screenGlow', () => {
  it('stays in 0..1 with a small amplitude around the mean', () => {
    const values = samples(0, 20, 0.05).map(t => screenGlow(t, 2));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread).toBeGreaterThan(0.05);
    expect(spread).toBeLessThanOrEqual(0.4);
    expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBeCloseTo(GLOW_MEAN, 1);
  });

  it('breathes slowly and repeats every period', () => {
    expect(GLOW_PERIOD).toBeGreaterThanOrEqual(4);
    expect(GLOW_PERIOD).toBeLessThanOrEqual(6);
    for (const t of samples(0, 10, 0.37)) expect(screenGlow(t + GLOW_PERIOD, 1)).toBeCloseTo(screenGlow(t, 1), 9);
    expect(screenGlow(3.3, 1)).toBe(screenGlow(3.3, 1));
  });
});

describe('plantSway', () => {
  it('is a small bounded rotation that moves', () => {
    const values = samples(0, 30, 0.05).map(t => plantSway(t, 3));
    for (const value of values) expect(Math.abs(value)).toBeLessThanOrEqual(Math.min(SWAY_MAX, 0.04));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.01);
  });
});

describe('cursorBlink', () => {
  it('toggles at about 1 Hz', () => {
    expect(cursorBlink(0)).toBe(true);
    expect(cursorBlink(0.6)).toBe(false);
    expect(cursorBlink(1.1)).toBe(true);
    const values = samples(0, 10, 0.05).map(cursorBlink);
    const toggles = values.slice(1).filter((value, i) => value !== values[i]).length;
    expect(toggles).toBeGreaterThanOrEqual(18);
    expect(toggles).toBeLessThanOrEqual(21);
  });
});

describe('seeds', () => {
  it('de-sync desks', () => {
    const glows = [0, 1, 2, 3, 4].map(seed => screenGlow(1, seed));
    const sways = [0, 1, 2, 3, 4].map(seed => plantSway(1, seed));
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
      expect(Math.abs(glows[a]! - glows[b]!), `glow ${a}/${b}`).toBeGreaterThan(1e-3);
      expect(Math.abs(sways[a]! - sways[b]!), `sway ${a}/${b}`).toBeGreaterThan(1e-4);
    }
  });
});

describe('busyLevel', () => {
  it('is 0 for an empty seat and for Dana', () => {
    expect(busyLevel(snapshot(), 'payables')).toBe(0);
    expect(busyLevel(snapshot({ agents: [agent('collections')], audit: [row('1', 'payables')] }), 'payables')).toBe(0);
    expect(busyLevel(snapshot({ agents: [agent('collections', 'dana')] }), 'dana')).toBe(0);
  });

  it('is 0 while the seat agent has walked away', () => {
    expect(busyLevel(snapshot({ agents: [agent('collections', 'dana')], audit: [row('1', 'collections')] }), 'collections')).toBe(0);
  });

  it('is idle when seated without a recent row', () => {
    expect(busyLevel(snapshot({ agents: [agent('payables')] }), 'payables')).toBe(IDLE_BUSY);
    const older = ['p', 'a', 'b', 'c'].map((id, i) => row(id, i === 0 ? 'payables' : 'collections'));
    expect(busyLevel(snapshot({ agents: [agent('payables')], audit: older }), 'payables')).toBe(IDLE_BUSY);
  });

  it('is 1 when seated with a row among the newest 3', () => {
    const audit = ['p', 'a', 'b'].map((id, i) => row(id, i === 0 ? 'payables' : 'collections'));
    expect(busyLevel(snapshot({ agents: [agent('payables')], audit }), 'payables')).toBe(1);
    expect(busyLevel(snapshot({ agents: [agent('payables')], audit: [row('x', 'payables')] }), 'payables')).toBe(1);
  });
});

describe('ambientDesks', () => {
  it('lists visible monitor desks with stable seeds', () => {
    expect(ambientDesks(snapshot({ rooms: undefined }))).toEqual([
      { room: 'collections', seed: 0 }, { room: 'payables', seed: 1 }, { room: 'vendor_onboarding', seed: 2 }, { room: 'dana', seed: 3 },
    ]);
    expect(ambientDesks(snapshot({ rooms: [{ id: 'dana', rowId: 'r' }, { id: 'lobby', rowId: 'l' }] }))).toEqual([{ room: 'dana', seed: 3 }]);
    expect(ambientDesks(snapshot({ rooms: [] }))).toEqual([]);
  });
});

describe('cursorPoint', () => {
  // Desk-local monitor face (DeskMonitors): 0.66 x 0.36 centred at (-0.35, 1.18); 19 px line step = 0.0475.
  const left = -0.35 - 0.33, right = -0.35 + 0.33, top = 1.18 + 0.18, bottom = 1.18 - 0.18;

  it('sits inside the screen, at the left text margin, one line below the last body line', () => {
    for (let lines = 0; lines <= MONITOR_MAX_LINES; lines++) {
      const [x, y] = cursorPoint(lines);
      expect(x - CURSOR_SIZE[0] / 2).toBeGreaterThan(left);
      expect(x + CURSOR_SIZE[0] / 2).toBeLessThan(left + 0.05);
      expect(y + CURSOR_SIZE[1] / 2).toBeLessThan(top);
      expect(y - CURSOR_SIZE[1] / 2).toBeGreaterThan(bottom);
    }
    expect(cursorPoint(1)[1] - cursorPoint(2)[1]).toBeCloseTo(0.0475, 6);
    expect(cursorPoint(2)[0]).toBe(cursorPoint(1)[0]);
  });

  it('stays clear of the heading, the status pill and the empty right strip', () => {
    // Heading baseline at 27 px and the pill (y 12..30 px) end 0.075 below the top; the right strip starts past the centre.
    const [x, y] = cursorPoint(0);
    expect(y + CURSOR_SIZE[1] / 2).toBeLessThan(top - 0.075);
    expect(x).toBeLessThan(right - 0.33);
  });

  it('clamps to the screen line slots', () => {
    expect(cursorPoint(-2)).toEqual(cursorPoint(0));
    expect(cursorPoint(MONITOR_MAX_LINES + 3)).toEqual(cursorPoint(MONITOR_MAX_LINES));
  });
});
