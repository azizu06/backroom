'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AskWhyVoiceResult } from '../lib/why-voice/types';

export function askWhyErrorMessage(status?: number, voice = false, code?: string): string {
  if (status === 409 && code === 'AUDIT_CHAIN_BROKEN') {
    return 'The audit chain is broken, so ask-why is paused (AUDIT_CHAIN_BROKEN).';
  }
  return voice ? 'Voice is unavailable. Type your question below.' : 'Could not answer. Try again.';
}

/** Text ask-why stays editable while voice arms/records; only the chain pause and in-flight text submit lock it. */
export function askWhyTextLocked(disabled: boolean, phase: 'idle' | 'arming' | 'recording' | 'thinking'): boolean {
  return disabled || phase === 'thinking';
}

/** The wall/office owns placement and optional citation selection. */
export function AskWhyVoice({ onAnswer, label = 'Ask why', disabled = false, disabledReason = 'Ask why is paused.' }: {
  onAnswer?: (answer: AskWhyVoiceResult) => void;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [phase, setPhase] = useState<'idle' | 'arming' | 'recording' | 'thinking'>('idle');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskWhyVoiceResult>();
  const [error, setError] = useState<string>();
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const held = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);

  function release() {
    held.current = false;
    clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }
  useEffect(() => {
    mounted.current = true;
    const blur = () => release();
    const hide = () => { if (document.hidden) release(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      if (recorder.current) recorder.current.onstop = null;
      release();
      request.current?.abort();
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => {
    if (result?.audio) void playback.current?.play().catch(() => { /* Native controls allow a user gesture. */ });
  }, [result]);

  useEffect(() => {
    if (!disabled) return;
    if (recorder.current) recorder.current.onstop = null;
    release();
    request.current?.abort();
    playback.current?.pause();
    busy.current = false;
    setPhase('idle');
    setResult(undefined);
    setError(undefined);
  }, [disabled]);

  async function send(body: BodyInit, voice: boolean) {
    if (disabledRef.current) return;
    setPhase('thinking');
    setError(undefined);
    setResult(undefined);
    request.current = new AbortController();
    try {
      const response = await fetch(voice ? '/api/why/voice' : '/api/why', {
        method: 'POST', body, headers: voice ? undefined : { 'Content-Type': 'application/json' },
        signal: request.current.signal,
      });
      if (!response.ok) {
        const data = response.status === 409 ? await response.json().catch(() => null) : null;
        throw Object.assign(new Error('REQUEST_FAILED'), { status: response.status, code: data?.error });
      }
      const answer: AskWhyVoiceResult = await response.json();
      if (!mounted.current || disabledRef.current) return;
      setResult(answer);
      setQuestion(answer.question);
      onAnswer?.(answer);
    } catch (e) {
      const failure = e as { status?: number; code?: string };
      if (mounted.current && !disabledRef.current) setError(askWhyErrorMessage(failure?.status, voice, failure?.code));
    } finally {
      busy.current = false;
      if (mounted.current) setPhase('idle');
    }
  }
  async function start() {
    if (disabledRef.current || busy.current) return;
    busy.current = true;
    held.current = true;
    setError(undefined);
    setPhase('arming');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('NO_MIC');
      playback.current?.pause();
      setResult(undefined);
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      if (!mounted.current || !held.current) {
        media.getTracks().forEach(track => track.stop());
        busy.current = false;
        if (mounted.current) setPhase('idle');
        return;
      }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('NO_AUDIO_FORMAT');
      const recording = new MediaRecorder(media, { mimeType, audioBitsPerSecond: 64000 });
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onerror = () => {
        recording.onstop = null;
        release();
        busy.current = false;
        setPhase('idle');
        setError('Recording failed. Type your question below.');
      };
      recording.onstop = () => {
        release();
        recorder.current = null;
        if (!mounted.current) return;
        const body = new FormData();
        body.set('audio', new Blob(chunks, { type: mimeType }), 'question');
        void send(body, true);
      };
      recording.start();
      setPhase('recording');
      timer.current = setTimeout(release, 15_000);
    } catch {
      release();
      busy.current = false;
      if (mounted.current) {
        setPhase('idle');
        setError('Microphone unavailable. Type your question below.');
      }
    }
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      void start();
    }
  }
  function keyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); release(); }
  }
  return <section aria-label={label}>
    <p>AI answers from the audit log. Voice audio is sent to Cartesia.</p>
    <button type="button" disabled={disabled || phase === 'thinking'} aria-pressed={phase === 'recording'}
      style={{ touchAction: 'none' }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        void start();
      }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onKeyDown={keyDown} onKeyUp={keyUp} onBlur={release}>
      {phase === 'recording' ? 'Release to ask' : phase === 'arming' ? 'Opening microphone…' : 'Hold to ask why'}
    </button>
    <form onSubmit={event => {
      event.preventDefault();
      if (disabledRef.current || phase === 'thinking' || !question.trim()) return;
      // Prefer typed ask-why over a stuck mic arm/recording: cancel voice and submit text.
      if (phase === 'arming' || phase === 'recording') {
        if (recorder.current) recorder.current.onstop = null;
        release();
        busy.current = false;
        setPhase('idle');
      }
      if (busy.current) return;
      busy.current = true;
      playback.current?.pause();
      void send(JSON.stringify({ question: question.trim() }), false);
    }}>
      {/* Text stays editable during voice arm/record so a mic prompt or stray Hold click cannot trap the field. */}
      <label>Question <input value={question} maxLength={1000} disabled={askWhyTextLocked(disabled, phase)}
        onChange={event => {
          if (phase === 'arming' || phase === 'recording') {
            if (recorder.current) recorder.current.onstop = null;
            release();
            busy.current = false;
            setPhase('idle');
          }
          setQuestion(event.target.value);
        }} /></label>
      <button type="submit" disabled={askWhyTextLocked(disabled, phase) || !question.trim()}>Ask why</button>
    </form>
    <span role="status">{phase === 'thinking' ? 'Checking the audit log…' : phase === 'recording' ? 'Recording (15 seconds maximum)' : ''}</span>
    {disabled && <p role="status">{disabledReason}</p>}
    {error && <p role="alert">{error}</p>}
    {result && <div>
      <p>{result.answer}</p>
      {result.audio ? <audio ref={playback} controls preload="auto"
        src={`data:${result.audio.mimeType};base64,${result.audio.base64}`} />
        : <p>Audio unavailable; the answer is shown above.</p>}
    </div>}
  </section>;
}
