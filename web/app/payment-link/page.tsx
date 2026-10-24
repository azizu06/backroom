import PaymentLinkPanel from '../../components/PaymentLinkPanel';
export const metadata = { title: 'Call payment link', robots: { index: false, follow: false }, referrer: 'no-referrer' };
/** Standalone demo display until the office owner places the same component. */
export default function PaymentLinkDisplay() {
  return <main style={{ background: '#101317', color: '#f2f2f2', minHeight: '100vh', padding: '2rem' }}><PaymentLinkPanel /></main>;
}
