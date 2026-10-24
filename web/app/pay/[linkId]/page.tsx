import PayCard from './PayCard';
export const metadata = { title: 'Pay Northfield Studio', referrer: 'no-referrer', robots: { index: false, follow: false } };
export default async function PayPage({ params }: { params: Promise<{ linkId: string }> }) {
  return <PayCard linkId={(await params).linkId} />;
}
