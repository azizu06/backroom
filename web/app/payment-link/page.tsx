import PaymentLinkPanel from '../../components/PaymentLinkPanel';
export const metadata = { title: 'Call payment link', robots: { index: false, follow: false }, referrer: 'no-referrer' };
/** Standalone display of the same panel the office lobby kiosk shows. */
export default function PaymentLinkDisplay() {
  return <main style={{ minHeight: '100vh', padding: '32px 16px 64px', boxSizing: 'border-box', display: 'grid', justifyItems: 'center', alignContent: 'start' }}><div style={{ width: 'min(360px, 100%)' }}><PaymentLinkPanel /></div></main>;
}
