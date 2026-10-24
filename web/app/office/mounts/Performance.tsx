'use client';

import { createRef, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { FrameAverage, officePerfEnabled } from '../../../lib/office/perf';
import { PerfOverlay, type PerfFields, type PerfValues } from '../PerfOverlay';

function Sampler() {
  const gl = useThree(state => state.gl);
  const started = useRef<number | null>(null);
  const latest = useRef<PerfValues | null>(null);
  const [average] = useState(() => new FrameAverage());
  const [fields] = useState<PerfFields>(() => ({ calls: createRef(), triangles: createRef(), geometries: createRef(), textures: createRef(), ms: createRef() }));
  // Negative priority keeps Fiber's automatic render. Start before contact-shadow useFrame passes.
  useFrame(() => { gl.info.reset(); started.current = performance.now(); }, -Infinity);
  useEffect(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none';
    gl.domElement.parentElement!.appendChild(host);
    const root = createRoot(host);
    queueMicrotask(() => { if (host.isConnected) root.render(<PerfOverlay fields={fields} latest={latest} />); });
    const autoReset = gl.info.autoReset;
    // Accumulate all passes in this demand frame, rather than only the final main-camera render.
    gl.info.autoReset = false;
    const unsubscribe = addAfterEffect(() => {
      if (started.current === null) return; // Another Canvas may have rendered without this one.
      const ms = average.add(performance.now() - started.current);
      started.current = null;
      const values = { calls: gl.info.render.calls, triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, ms: ms.toFixed(2) };
      latest.current = values;
      for (const key of Object.keys(fields) as (keyof PerfFields)[]) {
        if (fields[key].current) fields[key].current!.textContent = String(values[key]);
      }
    });
    return () => {
      unsubscribe();
      gl.info.autoReset = autoReset;
      gl.info.reset();
      host.remove();
      queueMicrotask(() => root.unmount());
    };
  }, [gl, fields, average]);
  return null;
}

/** Opt-in dev/judge readout. Never invalidates, starts a timer or keeps the demand loop awake. */
export function Performance() {
  const [enabled] = useState(() => officePerfEnabled(window.location.search));
  return enabled ? <Sampler /> : null;
}
