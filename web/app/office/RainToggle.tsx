'use client';

import { rainSetting, useRainEnabled } from '../../lib/office/rain-setting';

// Intentionally unmounted: the corner menu owns placement and styling.
export function RainToggle({ className }: { className?: string }) {
  const enabled = useRainEnabled();
  return <button type='button' className={className} aria-pressed={enabled}
    onClick={() => rainSetting.setEnabled(!enabled)} title='Gentle outdoor rain'>
    {enabled ? 'Rain on' : 'Rain off'}
  </button>;
}
