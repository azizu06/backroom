export const DEMO_GUIDE_STEPS: readonly { id: string; title: string; detail: string }[] = [
  { id: 'play', title: 'Switch to Play', detail: 'Choose “Play (first person)” from View, then walk with WASD or the arrow keys.' },
  { id: 'collections', title: 'Check Alex’s task', detail: 'Walk up to Alex at the Collections desk and press E to see the current task and audit receipts.' },
  { id: 'treasury', title: 'Test the Treasury lock', detail: 'Walk to the locked Treasury door on the right and press E. Entry is denied with the real rule id.' },
  { id: 'gx10', title: 'Visit the server room', detail: 'Go to the GX10 server room at the far right and press E for live tokens per second.' },
  { id: 'payment', title: 'Find the pay kiosk', detail: 'In the lobby, open a payment link from the pay kiosk.' },
  { id: 'previews', title: 'Replay key moments', detail: 'Use “Preview escalation” or “Preview Treasury denial” below the office.' },
  { id: 'why', title: 'Ask why', detail: 'On the lobby audit wall, ask why to get an explanation grounded in receipts.' },
];

export const OFFICE_SHORTCUTS: readonly { keys: string[]; action: string; mode: 'any' | 'play' | 'tour' }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: 'Walk', mode: 'play' },
  { keys: ['↑', '←', '↓', '→'], action: 'Walk and turn', mode: 'play' },
  { keys: ['E'], action: 'Interact: talk to an agent, inspect a desk, door or server', mode: 'play' },
  { keys: ['Click'], action: 'Look around with the mouse (Esc releases it)', mode: 'play' },
  { keys: ['Esc'], action: 'Exit Play, or close a panel', mode: 'play' },
  { keys: ['?'], action: 'Open keyboard shortcuts', mode: 'any' },
  { keys: ['Any key', 'Click'], action: 'Stop the tour', mode: 'tour' },
];
