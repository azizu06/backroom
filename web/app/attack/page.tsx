import { AttackDemoPanel } from '../../components/AttackDemoPanel';

export const metadata = { title: 'Try to trick the agents · Backroom' };
export default function AttackPage() {
  return <main className='attack-page'><nav aria-label='Back to office'><a href='/office'>← Office</a></nav><AttackDemoPanel /></main>;
}
