import type { CSSProperties } from 'react';
import './Bubbles.css';

/** [left %, size px, duration s, delay s, drift px]: fixed values so server and client render the same bubbles. */
const BUBBLES: readonly (readonly [number, number, number, number, number])[] = [
  [4, 220, 46, -8, 40], [14, 48, 28, -20, -18], [22, 120, 38, -2, 26], [31, 26, 24, -14, 12],
  [38, 300, 58, -30, -46], [47, 64, 32, -6, 20], [55, 160, 44, -24, -30], [63, 34, 26, -11, 16],
  [70, 240, 52, -40, 36], [78, 80, 34, -17, -22], [86, 140, 42, -4, 28], [93, 40, 30, -26, -14],
  [9, 90, 36, -33, 18], [43, 28, 22, -9, -10], [60, 110, 40, -36, 24], [97, 190, 50, -12, -34],
];

/** Decorative background: soft bubbles drift up behind every page. Never interactive, hidden from assistive tech. */
export function Bubbles() {
  return <div className='bubbles' aria-hidden='true'>
    {BUBBLES.map(([left, size, duration, delay, drift], index) => <span key={index} style={{
      '--left': `${left}%`, '--size': `${size}px`, '--duration': `${duration}s`, '--delay': `${delay}s`, '--drift': `${drift}px`,
    } as CSSProperties} />)}
  </div>;
}
