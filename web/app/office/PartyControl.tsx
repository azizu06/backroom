'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { PARTY_LINK_LABELS, partyErrorText } from '../../lib/office/party';
import type { PartyState } from './useParty';
import './party.css';

function JoinQr({ url }: { url: string }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let stopped = false;
    void QRCode.toDataURL(url, { width: 168, margin: 1, errorCorrectionLevel: 'M' }).then(data => { if (!stopped) setQr(data); }, () => { if (!stopped) setQr(''); });
    return () => { stopped = true; };
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return qr ? <img className='party-qr' src={qr} width={168} height={168} alt='Scan to join this office' /> : null;
}

/** Host side: open the office to teammates on this Wi-Fi as view-only guests. Guest side: a "viewing" chip. */
export function PartyControl({ party }: { party: PartyState }) {
  const { status, busy, start, stop } = party;
  const [open, setOpen] = useState(false);
  // Fixed under the button, portalled out of the toolbar: it scrolls sideways and its backdrop blur traps fixed children.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) {
        setOpen(false);
        if (event instanceof KeyboardEvent) button.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', close); };
  }, [open]);
  if (status.role === 'guest') return <span className='party-guest-chip' role='status'>Viewing as guest</span>;
  if (status.role !== 'host') return null;
  const hosting = !!status.hosting;
  const guests = status.guests ?? 0;
  const links = status.links ?? (status.url ? [{ kind: 'wifi' as const, url: status.url }] : []);
  function copy(url: string) {
    void navigator.clipboard?.writeText(url).then(() => { setCopied(url); window.setTimeout(() => setCopied(null), 1500); }, () => {});
  }
  return <div className='party-control'>
    <button ref={button} type='button' className='party-button' data-hosting={hosting || undefined} aria-expanded={open} aria-controls='party-panel'
      onClick={() => {
        const rect = button.current?.getBoundingClientRect();
        if (rect) setAt({ top: rect.bottom + 8, left: Math.max(16, Math.min(rect.left, window.innerWidth - 336)) });
        if (!hosting && !busy) start();
        setOpen(value => hosting ? !value : true);
      }}>
      {busy && !hosting ? 'Opening…' : hosting ? `Hosting · ${guests} ${guests === 1 ? 'guest' : 'guests'}` : 'Host Party'}
    </button>
    {open && createPortal(<div ref={panel} id='party-panel' className='party-panel' role='dialog' aria-label='Host party' style={at ?? undefined}>
      {hosting ? <>
        <p className='party-lede'>Send a teammate a link to watch the live office. Guests can look, not act.</p>
        {status.url && <JoinQr url={status.url} />}
        {status.online === 'starting' && <p className='party-hint' role='status'>Getting an online link that works on any network…</p>}
        {status.online === 'failed' && <p className='party-error' role='alert'>The online link could not start (is cloudflared installed?). The links below only work on the same network.</p>}
        {links.map(link => <div key={link.url} className='party-link'>
          <span><small>{PARTY_LINK_LABELS[link.kind]}</small><a href={link.url} target='_blank' rel='noreferrer'>{link.url}</a></span>
          <button type='button' onClick={() => copy(link.url)}>{copied === link.url ? 'Copied' : 'Copy'}</button>
        </div>)}
        <p className='party-hint'>Use the <strong>Online</strong> link: it works from any Wi-Fi or phone data. Anyone with it can watch until you stop hosting. Same Wi-Fi links start with <strong>http://</strong> and often fail on event Wi-Fi.</p>
        <button type='button' className='party-stop' disabled={busy} onClick={() => { stop(); setOpen(false); button.current?.focus(); }}>Stop hosting</button>
      </> : status.error ? <>
        <p className='party-error' role='alert'>{partyErrorText(status.error)}</p>
        <button type='button' disabled={busy} onClick={start}>Try again</button>
      </> : <p className='party-lede' role='status'>Opening the office to your Wi-Fi…</p>}
    </div>, button.current?.closest('.office-shell') ?? document.body)}
  </div>;
}
