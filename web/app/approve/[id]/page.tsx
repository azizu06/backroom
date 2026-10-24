import ApprovalCard from './ApprovalCard';

export const metadata = { title: 'Approval · Backroom' };
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  return <ApprovalCard id={(await params).id} />;
}
