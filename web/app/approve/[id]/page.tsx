import ApprovalCard from './ApprovalCard';
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  return <ApprovalCard id={(await params).id} />;
}
