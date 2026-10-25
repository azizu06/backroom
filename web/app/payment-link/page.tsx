import PaymentLinkPanel from '../../components/PaymentLinkPanel';
export const metadata = { title: 'Call payment link', robots: { index: false, follow: false }, referrer: 'no-referrer' };
/** Standalone demo display until the office owner places the same component. */
export default function PaymentLinkDisplay() {
  return <main style={{ minHeight: '100vh', padding: '2rem 16px', boxSizing: 'border-box' }}><PaymentLinkPanel /></main>;
}
