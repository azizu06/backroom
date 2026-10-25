'use client';

import { useEffect, useRef, useState } from 'react';
import { REDUCED_MOTION_QUERY } from '../../lib/office/a11y';
import { OFFICE_ANCHORS, visibleRooms, type OfficeSnapshot } from '../../lib/office/state';
import { headingRotation, mapTransform, minimapItems, roomAt, worldToMap } from '../../lib/office/minimap';
import { SPAWN, type PlayBridge } from '../../lib/office/play';
import './minimap.css';

const STORAGE_KEY = 'office.minimap';
function readPreference() {
  try { return window.localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}
function savePreference(on: boolean) { try { window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ } }

export function PlayMinimap({ snapshot, hud }: { snapshot: OfficeSnapshot; hud: PlayBridge['hud'] }) {
  const [shown, setShown] = useState(true);
  const marker = useRef<SVGGElement>(null);
  const size = 184;
  const transform = mapTransform(size, 9);
  const rooms = visibleRooms(snapshot);
  const items = minimapItems(snapshot, rooms);

  useEffect(() => { setShown(readPreference()); }, []);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'm' || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setShown(value => { savePreference(!value); return !value; });
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);
  useEffect(() => {
    if (!shown) return;
    let timer: ReturnType<typeof setInterval>;
    const update = () => {
      const surface = hud.current;
      const x = Number(surface?.dataset.playerX ?? SPAWN.position[0]);
      const z = Number(surface?.dataset.playerZ ?? SPAWN.position[1]);
      const yaw = Number(surface?.dataset.playerYaw ?? SPAWN.yaw);
      const point = worldToMap([x, z], transform);
      marker.current?.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${headingRotation(yaw)})`);
    };
    update(); timer = setInterval(update, 67);
    return () => clearInterval(timer);
  }, [shown, hud, transform.scale, transform.offsetX, transform.offsetY]);

  const x = Number(hud.current?.dataset.playerX ?? SPAWN.position[0]);
  const z = Number(hud.current?.dataset.playerZ ?? SPAWN.position[1]);
  const room = roomAt([x, z], rooms);
  return <div className='play-minimap-wrap'>
    {shown && <svg className='play-minimap' viewBox={`0 0 ${size} ${size}`} role='img' aria-label={room ? `Office map. You are in ${room}.` : 'Office map'}>
      <rect className='minimap-bg' x='0' y='0' width={size} height={size} rx='8' />
      {items.filter(item => item.kind === 'room').map(item => {
        const point = worldToMap(item.position, transform);
        const dims = item.id === 'lobby' ? [2.8, 2.2] : item.id === 'treasury' ? [2.7, 2.7] : [2.1, 1.8];
        return <g key={item.id} className='minimap-room'>
          <rect x={point.x - dims[0]! * transform.scale / 2} y={point.y - dims[1]! * transform.scale / 2} width={dims[0]! * transform.scale} height={dims[1]! * transform.scale} rx='3' />
          <text x={point.x} y={point.y + 3}>{item.name}</text>
        </g>;
      })}
      {items.filter(item => item.kind === 'door' || item.kind === 'server' || item.kind === 'kiosk' || item.kind === 'board').map(item => {
        const point = worldToMap(item.position, transform);
        return <g key={item.kind} className={`minimap-${item.kind === 'board' ? 'kiosk' : item.kind}`}><circle cx={point.x} cy={point.y} r='3.5' /><title>{item.name}</title></g>;
      })}
      {items.filter(item => item.kind === 'agent').map(item => {
        const point = worldToMap(item.position, transform);
        return <g key={item.id} className={item.alert ? 'minimap-agent is-alert' : 'minimap-agent'} style={{ '--agent-color': item.color } as React.CSSProperties} aria-label={`${item.name}${item.alert ? ', escalation or denial' : ''}`}>
          <circle cx={point.x} cy={point.y} r='3.5'><title>{item.name}</title></circle>
        </g>;
      })}
      <g ref={marker} className='minimap-player' transform={`translate(${worldToMap(SPAWN.position, transform).x} ${worldToMap(SPAWN.position, transform).y})`} aria-hidden='true'><path d='M 0 -6 L 4.5 5 L 0 2.7 L -4.5 5 Z' /></g>
    </svg>}
    <button className='play-minimap-toggle' type='button' aria-pressed={shown} aria-label={shown ? 'Hide map' : 'Show map'} onClick={() => { savePreference(!shown); setShown(value => !value); }}>M · Map</button>
  </div>;
}
