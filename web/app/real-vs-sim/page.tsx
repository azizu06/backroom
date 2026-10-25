import { RealVsSim } from '../../components/RealVsSim';

export const metadata = { title: 'System status · Backroom' };

export default function RealVsSimPage() {
  return <main style={{ minHeight: '100dvh', padding: '32px 16px 64px', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: '16px', boxSizing: 'border-box' }}>
    <RealVsSim />
  </main>;
}
