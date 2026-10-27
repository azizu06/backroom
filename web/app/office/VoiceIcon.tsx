import type { VoiceLevel } from '../../lib/office/voice';

/** Speaker with 1-3 sound waves: shown on a person's name tag while their voice is arriving. */
export function VoiceIcon({ level }: { level: VoiceLevel }) {
  if (!level) return null;
  return <svg className='voice-icon' data-level={level} width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.6'
    strokeLinecap='round' strokeLinejoin='round' role='img' aria-label='talking' style={{ verticalAlign: '-2px', marginRight: 4, color: '#9be7c4' }}>
    <path d='M3 9.5h3.5L11 5.5v13l-4.5-4H3z' fill='currentColor' stroke='none' />
    <path d='M14.5 10a2.5 2.5 0 0 1 0 4' />
    {level >= 2 && <path d='M17 8a5.5 5.5 0 0 1 0 8' />}
    {level >= 3 && <path d='M19.5 5.5a9 9 0 0 1 0 13' />}
  </svg>;
}
