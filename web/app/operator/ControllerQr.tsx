'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import styles from './operator.module.css';

/** Phone link to Dana's controller. Passkeys bind to the public origin, so the QR is drawn only once the host reports it. */
export default function ControllerQr({ url }: { url: string }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let stopped = false;
    void QRCode.toDataURL(url, { width: 192, margin: 2, errorCorrectionLevel: 'M' }).then(data => { if (!stopped) setQr(data); }, () => { if (!stopped) setQr(''); });
    return () => { stopped = true; };
  }, [url]);
  return <div className={styles.qr}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {qr && <img src={qr} width={192} height={192} alt="Scan to open Dana's controller on a phone" />}
    <a href={url} rel='noreferrer'>{url}</a>
  </div>;
}
