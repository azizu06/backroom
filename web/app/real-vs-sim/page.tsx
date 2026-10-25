import { RealVsSim } from '../../components/RealVsSim';

export const metadata = { title: 'Real vs. simulated · Backroom' };

export default function RealVsSimPage() {
  return <main style={{ minHeight: '100dvh', padding: '24px 16px', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: '16px', boxSizing: 'border-box' }}>
    <RealVsSim />
  </main>;
}
