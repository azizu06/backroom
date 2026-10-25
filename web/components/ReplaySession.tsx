'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReplayRecording } from '@backroom/orchestrator/replay';
import { createReplayPlayer } from '../lib/replay/player';
import { Office } from '../app/office/Office';
import { AuditWall, type AuditSnapshot } from './AuditWall';
import './ReplaySession.css';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
export function ReplaySession({ recording, view }: { recording: ReplayRecording; view: 'office' | 'audit' }) {
  const [player] = useState(() => createReplayPlayer(recording));
  const snapshot = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  useEffect(() => {
    let frame = 0, previous = performance.now();
    const tick = (now: number) => { player.advance(now - previous); previous = now; frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    player.play();
    return () => { cancelAnimationFrame(frame); player.pause(); };
  }, [player]);
  const audit: AuditSnapshot = { entries: snapshot.entries, measuredAt: snapshot.measuredAt,
    chain: { valid: true, firstBrokenSeq: null, length: snapshot.entries.length,
      headHash: snapshot.entries.at(-1)?.hash ?? '0'.repeat(64) } };
  return <div className='replay-session'>
    <header className='replay-controls' aria-label='Replay controls'>
      <strong>REPLAY</strong><span>{recording.header.name} · {snapshot.phase}</span>
      <button onClick={() => snapshot.playing ? player.pause() : player.play()}>{snapshot.playing ? 'Pause' : 'Play'}</button>
      <label>Speed <select value={snapshot.speed} onChange={e => player.setSpeed(Number(e.target.value))}>
        {[0.25, 0.5, 1, 2, 4, 8].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
      </select></label>
      <label className='replay-scrub'>Position <input aria-label='Replay position' type='range' min={0} max={recording.durationMs} step={1}
        value={snapshot.positionMs} onChange={e => player.seek(Number(e.target.value))} /></label>
      <output>{seconds(snapshot.positionMs)} / {seconds(recording.durationMs)}</output>
      <a href={`/${view === 'office' ? 'audit' : 'office'}?replay=${encodeURIComponent(recording.header.name)}`}>{view === 'office' ? 'Full audit wall' : '3D office'}</a>
      <details><summary>Recording details</summary><p>REPLAY recorded {recording.header.recordedAt}</p><p>{recording.header.provenance}. Never a live call or live money movement.</p>
        <label>Phase <select aria-label='Replay phase' value={snapshot.phase} onChange={e => player.seek(recording.frames.find(frame => frame.phase === e.target.value)!.atMs)}>
          {[...new Set(recording.frames.map(frame => frame.phase))].map(phase => <option key={phase}>{phase}</option>)}
        </select></label></details>
    </header>
    <div className='replay-stage'>
      {view === 'office' ? <><Office source={player.source} /><AuditWall key={snapshot.phase} recording={audit} /></> : <AuditWall key={snapshot.phase} recording={audit} />}
    </div>
  </div>;
}
export function ReplayUnavailable() {
  return <main className='replay-session'><header className='replay-controls'><strong>REPLAY</strong><span>Recording unavailable or invalid</span></header>
    <p role='alert'>This recording could not be verified. Choose a bundled recording such as <a href='/office?replay=core-offline'>core-offline</a>.</p></main>;
}
