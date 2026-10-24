import { AuditWall } from '../../components/AuditWall';

export const metadata = { title: 'Audit wall · Backroom' };
export default function AuditPage() {
  return <main style={{ background: '#111113' }}>
    <nav aria-label="Office" style={{ padding: '16px 24px 0', fontFamily: 'system-ui, sans-serif' }}><a href="/" style={{ color: '#d8d8e0' }}>← Back to office</a></nav>
    <AuditWall />
  </main>;
}
