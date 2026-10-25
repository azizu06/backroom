import { RealVsSim } from '../../components/RealVsSim';

export const metadata = { title: 'Real vs. simulated · Backroom' };

export default function RealVsSimPage() {
  return <main style={{ minHeight: '100dvh', background: 'var(--office-cream)', padding: '24px', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: '16px', fontFamily: 'system-ui, sans-serif' }}>
    <RealVsSim />
  </main>;
}
