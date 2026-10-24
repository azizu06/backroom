import Link from 'next/link';
import { disclosureItems } from '../../lib/real-vs-sim';
import './start.css';

export const metadata = { title: 'Start · Backroom' };

const steps = [
  { title: 'Story mode', href: '/office?demo=story', time: '35 sec',
    instruction: 'Follow the office story.', outcome: 'See agents work within their badges and bring exceptions to the owner.' },
  { title: 'Play mode', href: '/office', time: '40 sec',
    instruction: 'Choose View → Play, walk to the Treasury door, and press E.', outcome: 'Inspect a restricted room from inside the office.' },
  { title: 'Treasury DENY preview', href: '/office', time: '20 sec',
    instruction: 'Select “Preview Treasury denial”.', outcome: 'See the door refusal and its simulated audit receipt.' },
  { title: 'Ask why on the audit wall', href: '/audit', time: '40 sec',
    instruction: 'Open the wall with an operator code, then ask about a decision.', outcome: 'Read an explanation tied to recorded evidence.' },
  { title: 'Visual escalation preview', href: '/office', time: '30 sec',
    instruction: <>Choose “Preview escalation” below the office. The agent walks the case to Dana’s desk and stops. The preview is a visual fixture. A real passkey approval link comes from a seeded approval, or from an approval you create in the <Link href='/inbox'>inbox</Link>.</>,
    outcome: 'See that an exception waits for a person, never a model or a voice.' },
  { title: 'Real vs simulated status', href: '/real-vs-sim', time: '15 sec',
    instruction: 'Read the integration and sandbox disclosures.', outcome: 'Know which parts are real, simulated, or unverified.' },
] as const;

export default function StartPage() {
  return <main className='start-page'>
    <header>
      <h1>Backroom: start here</h1>
      <p className='start-pitch'>A 3D back office for a small business with no finance team. AI agents work finance seats; their limits are enforced on the server and visible in the office.</p>
    </header>
    <section aria-labelledby='start-try'>
      <h2 id='start-try'>Try this in 3 minutes</h2>
      <ol className='start-cards'>
        {steps.map(step => <li key={step.title}>
          <article>
            <p className='start-time'>About {step.time}</p>
            <h3><Link href={step.href}>{step.title}</Link></h3>
            <p>{step.instruction}</p>
            <p className='start-outcome'>{step.outcome}</p>
          </article>
        </li>)}
      </ol>
    </section>
    <section className='start-real' aria-labelledby='start-real'>
      <h2 id='start-real'>What’s real</h2>
      <ul>
        <li><strong>Real integrations:</strong> {disclosureItems.filter(item => item.kind === 'real').map(item => item.label).join(', ')}.</li>
        <li><strong>Sandbox / simulated:</strong> {disclosureItems.filter(item => item.kind === 'sandbox').map(item => item.label).join(', ')}. No real money or customer credit reports.</li>
      </ul>
      <p>Integration availability can be unverified or offline. <Link href='/real-vs-sim'>Check current status and evidence</Link>.</p>
    </section>
    <footer>No money moves without a human passkey.</footer>
  </main>;
}
