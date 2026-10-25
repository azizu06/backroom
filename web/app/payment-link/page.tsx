import PaymentLinkPanel from '../../components/PaymentLinkPanel';
export const metadata = { title: 'Call payment link', robots: { index: false, follow: false }, referrer: 'no-referrer' };
/** Standalone display of the same panel the office lobby kiosk shows. */
export default function PaymentLinkDisplay() {
  return <main className='page-frame'>
    <h1 className='page-title'>Call payment link</h1>
    <p className='page-lede'>The link Dana authorized on the current call. Checks for a new link every two seconds.</p>
    <PaymentLinkPanel payButton />
  </main>;
}
