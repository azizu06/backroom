'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WORKSTATION_SEATS } from '../../lib/office/baked-seat';
import { SCREEN_ENDPOINT, SCREEN_INTERVAL_MS, SCREEN_MAX_WIDTH, SCREEN_QUALITY, SCREEN_WATCH_RADIUS, mySeat, parseSeats, screenStore, type ScreenIntent } from '../../lib/office/screens';

/** Background tabs throttle page timers; a worker's timer keeps snapshots coming while you use other apps. */
const TICK_WORKER = `setInterval(() => postMessage(0), ${SCREEN_INTERVAL_MS});`;
const PING_EVERY = Math.round(25_000 / SCREEN_INTERVAL_MS);

type Grab = () => Promise<CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null>;
/** ImageCapture keeps grabbing frames when the tab is hidden (Chrome, Edge); a playing video is the fallback. */
function frameGrabber(stream: MediaStream): { grab: Grab; stop(): void } {
  const track = stream.getVideoTracks()[0]!;
  const Capture = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  if (Capture) {
    const capture = new Capture(track);
    let last: ImageBitmap | null = null;
    return { grab: async () => { try { last?.close(); last = await capture.grabFrame(); return last; } catch { return null; } }, stop: () => last?.close() };
  }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  void video.play().catch(() => {});
  return { grab: async () => video.readyState >= 2 ? video : null, stop: () => { video.srcObject = null; } };
}

/**
 * Desk screen sharing through the demo host's relay. Seats come from the relay; a desk's live image arrives only
 * while you stand near it in Play (or have its watch overlay open). Nothing here acts on the office.
 */
export function useScreenShare({ enabled, selfId, selfName, hud, play }: {
  enabled: boolean; selfId: string; selfName: string; hud: { current: HTMLElement | null }; play: boolean;
}) {
  const state = useSyncExternalStore(screenStore.subscribe, screenStore.getSnapshot, screenStore.getServerSnapshot);
  const [overlay, setOverlay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the relay socket drops (a tunnel closes idle sockets): reconnect shortly after.
  const [attempt, setAttempt] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const share = useRef<{ stream: MediaStream; stop(): void } | null>(null);
  const watching = useRef('');
  const sharingDesk = useRef<number | undefined>(undefined);
  const nameRef = useRef(selfName);
  nameRef.current = selfName;
  const send = (body: unknown) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(body)); };

  useEffect(() => {
    screenStore.set({ enabled: enabled && !!selfId, selfId });
    if (!enabled || !selfId) return;
    const url = new URL(`${SCREEN_ENDPOINT}?viewer=${encodeURIComponent(selfId)}`, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    socket.current = ws;
    watching.current = '';
    let retry: number | undefined;
    ws.onclose = () => { if (socket.current === ws) retry = window.setTimeout(() => setAttempt(n => n + 1), 2000); };
    ws.onopen = () => { const desk = mySeat(screenStore.getSnapshot())?.desk ?? (share.current ? sharingDesk.current : undefined); if (share.current && desk !== undefined) send({ type: 'sit', desk, name: nameRef.current }); };
    ws.onmessage = event => {
      if (typeof event.data === 'string') {
        let message: unknown;
        try { message = JSON.parse(event.data); } catch { return; }
        const seats = parseSeats(message);
        if (seats) {
          for (const desk of Object.keys(screenStore.getSnapshot().frames).map(Number)) if (!seats.some(seat => seat.desk === desk)) screenStore.putImage(desk, null);
          screenStore.set({ seats });
        } else if ((message as { code?: unknown }).code === 'SEAT_TAKEN') setError('Someone just sat at that desk.');
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const desk = bytes[0]!;
      void createImageBitmap(new Blob([bytes.subarray(1)], { type: 'image/jpeg' })).then(image => screenStore.putImage(desk, image), () => {});
    };
    return () => {
      window.clearTimeout(retry);
      socket.current = null; ws.close();
      for (const desk of Object.keys(screenStore.getSnapshot().frames).map(Number)) screenStore.putImage(desk, null);
      screenStore.set({ enabled: false, seats: [] });
    };
  }, [enabled, selfId, attempt]);

  const stopSharing = useCallback(() => {
    share.current?.stop(); share.current = null; sharingDesk.current = undefined;
    send({ type: 'stand' });
  }, []);

  const startSharing = useCallback(async (desk: number) => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) { setError('Screen sharing needs the https link or this laptop.'); return; }
    document.exitPointerLock?.();
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false }); }
    catch { return; } // Cancelled in the browser's picker.
    share.current?.stop();
    const grabber = frameGrabber(stream);
    const canvas = document.createElement('canvas');
    const worker = new Worker(URL.createObjectURL(new Blob([TICK_WORKER], { type: 'application/javascript' })));
    let busy = false, ticks = 0;
    worker.onmessage = async () => {
      if (++ticks % PING_EVERY === 0) send({ type: 'ping' });
      if (busy || socket.current?.readyState !== WebSocket.OPEN) return;
      busy = true;
      try {
        const frame = await grabber.grab();
        const width = frame?.videoWidth ?? frame?.width ?? 0, height = frame?.videoHeight ?? frame?.height ?? 0;
        if (!frame || !width || !height) return;
        const scale = Math.min(1, SCREEN_MAX_WIDTH / width);
        canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
        canvas.getContext('2d')!.drawImage(frame, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', SCREEN_QUALITY));
        if (blob && socket.current?.readyState === WebSocket.OPEN) socket.current.send(await blob.arrayBuffer());
      } finally { busy = false; }
    };
    const stop = () => { worker.terminate(); grabber.stop(); stream.getTracks().forEach(track => track.stop()); };
    share.current = { stream, stop };
    // The browser's own "Stop sharing" bar ends the track: stand up too.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (share.current?.stream === stream) stopSharing(); });
    sharingDesk.current = desk;
    send({ type: 'sit', desk, name: nameRef.current });
  }, [stopSharing]);
  useEffect(() => () => { share.current?.stop(); share.current = null; }, []);

  useEffect(() => {
    screenStore.onIntent((intent: ScreenIntent) => {
      if (intent.kind === 'sit') void startSharing(intent.desk);
      else if (intent.kind === 'stand') stopSharing();
      else { document.exitPointerLock?.(); setOverlay(intent.desk); }
    });
    return () => screenStore.onIntent(null);
  }, [startSharing, stopSharing]);

  // Ask for the screens you can see: occupied desks within reach in Play, plus the one open in the overlay.
  useEffect(() => {
    if (!state.enabled) return;
    const timer = window.setInterval(() => {
      const data = hud.current?.dataset, current = screenStore.getSnapshot();
      const x = Number(data?.playerX), z = Number(data?.playerZ);
      const near = current.seats.filter(seat => seat.viewerId !== current.selfId && (seat.desk === overlay || (play && Number.isFinite(x) && Number.isFinite(z)
        && Math.hypot(WORKSTATION_SEATS[seat.desk]!.x - x, WORKSTATION_SEATS[seat.desk]!.z - z) <= SCREEN_WATCH_RADIUS))).map(seat => seat.desk).sort((a, b) => a - b);
      const key = near.join(',');
      if (key === watching.current) return;
      watching.current = key;
      send({ type: 'watch', desks: near });
      for (const desk of Object.keys(current.frames).map(Number)) if (!near.includes(desk)) screenStore.putImage(desk, null);
    }, SCREEN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state.enabled, hud, play, overlay]);

  // Close the overlay if that person stood up.
  useEffect(() => { if (overlay !== null && !state.seats.some(seat => seat.desk === overlay)) setOverlay(null); }, [overlay, state.seats]);

  return { state, sharing: mySeat(state)?.desk ?? null, overlay, closeOverlay: () => setOverlay(null), stopSharing, error, clearError: () => setError(null) };
}
