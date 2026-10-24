'use client';

import { useLayoutEffect, type RefObject } from 'react';
import './perf.css';

export type PerfValues = Record<'calls' | 'triangles' | 'geometries' | 'textures' | 'ms', string | number>;
export type PerfFields = Record<keyof PerfValues, RefObject<HTMLSpanElement | null>>;

/** HTML only. The lazy scene writes counters without scheduling React or Canvas updates. */
export function PerfOverlay({ fields, latest }: { fields: PerfFields; latest: RefObject<PerfValues | null> }) {
  // The DOM root may commit after the Canvas falls idle. Keep its last sample without waking it.
  useLayoutEffect(() => {
    if (!latest.current) return;
    for (const key of Object.keys(fields) as (keyof PerfFields)[]) {
      if (fields[key].current) fields[key].current!.textContent = String(latest.current[key]);
    }
  }, [fields, latest]);
  return <aside className='office-perf' aria-label='Office performance' data-testid='office-perf'>
    <strong>Office performance</strong>
    <dl aria-live='off'>
      <div><dt>draw calls</dt><dd><span ref={fields.calls} data-testid='office-perf-calls'>—</span></dd></div>
      <div><dt>triangles</dt><dd><span ref={fields.triangles}>—</span></dd></div>
      <div><dt>geometries</dt><dd><span ref={fields.geometries}>—</span></dd></div>
      <div><dt>textures</dt><dd><span ref={fields.textures}>—</span></dd></div>
      <div><dt>frame CPU avg</dt><dd><span ref={fields.ms}>—</span> ms</dd></div>
    </dl>
    <small>Last 60 rendered frames · includes shadow passes</small>
  </aside>;
}
