import PaymentLinkPanel from '../../components/PaymentLinkPanel';
export const metadata = { title: 'Payment link · Backroom', robots: { index: false, follow: false }, referrer: 'no-referrer' };
/** Standalone display of the same panel the office lobby kiosk shows. */
export default function PaymentLinkDisplay() {
  return <main className='page-frame'>
    <h1 className='page-title'>Call Payment Link</h1>
    <p className='page-lede'>The link Dana authorized on the current call. Checks for a new link every two seconds.</p>
    <PaymentLinkPanel payButton />
  </main>;
}
